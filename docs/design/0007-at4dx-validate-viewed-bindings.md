# 0007 — Validating the Bindings You're Viewing

**Status:** Draft
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-26

## Problem

The panel already knows about exactly one binding problem: `⚠ order collision`, a badge
`domainProcessBindingPanel.ts` renders from `row.orderCollision`. That flag came free with
`resolveDomainProcessBindings`, which the panel was calling anyway.

Since then the companion CLI repo grew a real validator —
`validateDomainProcessBindings` in `@simplysf/simply-aep-core`, designed in
[SimplySF/simply-node's 0010](https://github.com/SimplySF/simply-node/blob/main/docs/design/0010-at4dx-domain-process-binding-validate.md)
— that checks five rules. Order collision is one of them. The panel shows none of the other four, and
[0006](0006-at4dx-direct-library-imports.md) means the function is already in this extension's process,
one call away from data we've already scanned.

That gap is worse than "four missing badges," because two of those rules describe bindings the panel
**structurally cannot display**:

- **`missing-sobject-reference`** — a record with neither `RelatedDomainBindingSObject__c` nor
  `RelatedDomainBindingSObjectAlternate__c` set. The scanners exclude these from `records` entirely
  (there's no SObject to file them under), so they never reach `ALL_ROWS`, never appear in the SObject
  dropdown, and are invisible in the panel by construction. The user's binding is sitting in their
  source tree doing nothing, and the tool built to show them their bindings shows nothing at all.
- **`missing-context-field`** on a `TriggerExecution` record with a blank `TriggerOperation__c` — a
  dead binding that can never match any trigger. It *is* in `ALL_ROWS` and it *does* contribute its
  SObject to the dropdown, but `availableFamilies()` matches its blank operation against no family and
  `buildSections()` filters it out of both the Before and After sections. So it silently inflates the
  SObject list and then renders nowhere. A user who picks that SObject sees an empty or short list and
  has no way to learn why.

So today, finding out whether what you're looking at is correct means leaving the editor for a
terminal and running `sf simply aep at4dx domain-process-binding validate` — reintroducing the exact
Salesforce-CLI dependency [0005](0005-at4dx-org-list-via-core.md) and
[0006](0006-at4dx-direct-library-imports.md) removed.

## Decision

Validate every scan, always, and render the results in the panel the user is already looking at.

Validation is a pure in-memory pass over records we have already fetched — no extra query, no extra
file read, no measurable time. There is no reason to make the user ask for it, and no reason for it to
be a separate command that re-scans. `getDomainProcessBindings` starts returning issues alongside
rows; the panel renders them in three places (a summary bar, per-row badges, and a section for issues
that have no row to attach to); and the SObject dropdown projects the record-scoped ones the same way
it already projects rows.

The projection has to be done correctly, and that correctness lives in the library, not here:
`duplicate-developer-name` and `missing-sobject-reference` are **scan-scoped** — filtering to one
SObject before validating gives wrong answers for the first and drops the second entirely. The
companion repo's
[0011](https://github.com/SimplySF/simply-node/blob/main/docs/design/0011-domain-process-binding-issue-scoping.md)
adds the `scope` field and the `filterDomainProcessBindingIssues` partition that make this expressible;
this doc consumes them and depends on that version shipping first. This extension does not encode
which rules are scan-scoped — that knowledge stays in one repo.

This also picks up the `@simplysf/simply-aep-core` upgrade the extension has been sitting on:
`package.json` pins `^0.2.0`, which under npm's 0.x semver rules can't resolve `0.3.0`, so the panel is
still on the pre-`validate` library. `0.3.0` reshaped `scanLocalDomainProcessBindings`'s return from a
bare array to `{ records, malformed, ambiguous }` (0010's one breaking change), and `at4dxCli.ts`'s
call site is written against the old shape — so the bump is part of this work, not a separate chore.

## Behavior

No new command and no new setting. Everything below happens inside the existing
**AT4DX: Show Domain Process Bindings** flow.

### What the panel shows

| Surface | Content |
| --- | --- |
| **Summary bar** (top of panel, above the dropdowns) | `✓ No problems found` when the scan is clean; otherwise `⚠ N errors · M warnings` split into *in this SObject* and *elsewhere in this scan*, so a user filtered to `Account` is never told everything is fine while three bindings are broken under `Contact`. Clicking it scrolls to the Issues section. |
| **Per-row badge** | One chip per issue **naming that record**, labelled with the rule's `title`, coloured by `severity` (`--vscode-editorError-foreground` / `--vscode-editorWarning-foreground`), with the issue's `message` as its `title` tooltip. The existing hand-written `⚠ order collision` badge is deleted and becomes one instance of this mechanism — same appearance, now driven by the issue list instead of `row.orderCollision`. |
| **Issues section** (below the binding sections) | Two groups: `In {SObject}` — record-scoped issues for the current selection — and `Elsewhere in this scan` — every scan-scoped issue plus every record-scoped issue belonging to another SObject, each showing which. Entries show severity icon, rule title, `developerName`, `source`, and message. This is the only place a `missing-sobject-reference` binding ever appears — it has no row and no SObject, so a section is the only surface that can hold it. |

Rows the panel currently drops on the floor stay dropped as *rows* — a blank-`TriggerOperation__c`
record still can't be filed under a trigger event, because there isn't one. It now shows up as an
issue naming it, which is the honest rendering: not "here is your binding," but "this binding is
declared and can never run."

### Two different joins, on purpose

Badges and the Issues section answer different questions, so they use different keys, and conflating
them is the easiest way to get this feature subtly wrong.

**Badges join on identity — `(developerName, source)` — and ignore `scope`.** If an issue names this
record, this record has that problem; that is true regardless of how the issue was computed. So one
half of a cross-SObject `duplicate-developer-name` pair badges its Account row, and the other half
badges its Contact row when the user switches. `missing-sobject-reference` issues badge nothing,
because no row exists for them.

**The section and the summary counts partition on `scope`,** because they answer "is what I'm looking
at complete?" A record-scoped issue is guaranteed to be fully visible when its SObject is selected —
that's what [0011's round-trip test](https://github.com/SimplySF/simply-node/blob/main/docs/design/0011-domain-process-binding-issue-scoping.md)
pins down. A scan-scoped issue carries no such guarantee, so it is always listed, in full, under
`Elsewhere in this scan` — never filtered away, never split across selections.

`(developerName, source)` is unique per scan, per 0011. Two records sharing both — only reachable from
two source roots with same-basename package directories — would badge each other's rows; accepted,
because that case *is* a `duplicate-developer-name` error and both rows get that badge anyway.

### Selection and projection

The webview keeps doing its filtering client-side (0003's model — everything is embedded once,
dropdown changes never round-trip to the host). The host embeds three values:

```js
const ALL_ROWS = [...];    // unchanged
const ALL_ISSUES = [...];  // DomainProcessBindingIssue[], the whole scan, unfiltered
const RULE_INFO = {...};   // DOMAIN_PROCESS_BINDING_RULES, forwarded verbatim
```

and the client partitions per selection on each issue's own `scope` field:

```js
const inView = ALL_ISSUES.filter((i) => i.scope === 'record' && i.sobject === sobject);
const elsewhere = ALL_ISSUES.filter((i) => !(i.scope === 'record' && i.sobject === sobject));
```

That two-line filter is why
[0011](https://github.com/SimplySF/simply-node/blob/main/docs/design/0011-domain-process-binding-issue-scoping.md)
stamps `scope` onto each issue rather than leaving it only in a lookup table: the webview is a
separate JS context that cannot import the library, and the alternative is a copy of the five-rule
scope mapping maintained by hand in plain JS in this file.

To be accurate about the division of labour: the **host does not call
`filterDomainProcessBindingIssues`**. `extension.ts` passes no SObject filter (the panel has always
filtered client-side), so the host has nothing to project and the partition necessarily happens in the
webview, per selection. That library function remains the normative definition of the projection —
it's what `simply-aep`'s `validate` command uses and what 0011's tests pin — and the client filter
above is a two-property mirror of it, which is only safe *because* `scope` travels on the data. If a
host-side SObject filter is ever added (see Open questions), it should call the real function rather
than grow a second copy.

`RULE_INFO` is forwarded rather than re-derived because rule titles don't survive being reconstructed
from the rule slug: `missing-sobject-reference` de-slugs to "Missing sobject reference", not "Missing
SObject reference". Forwarding also gets `summary` for free if tooltips ever want it.

### Clicking an issue

| Source | Behavior |
| --- | --- |
| Local, issue has `filePath` (0011 adds it) | Opens that `.md-meta.xml` beside the panel — same `showTextDocument(..., ViewColumn.Beside)` treatment `openApexClass` already gives a row click. |
| Local, no `filePath` | Falls back to `workspace.findFiles('**/DomainProcessBinding.<developerName>.md-meta.xml')`, mirroring `openApexClass`'s existing glob. |
| Org | Not clickable — there's no local file. The entry renders without the link affordance rather than opening a "couldn't find it" warning. |

Row clicks keep opening the Apex class, unchanged.

### Failure behavior

Validation can't fail independently of the scan: it's a pure function over records already in memory,
so the `loading` / `error` / `empty` / `data` states are unchanged. `getDomainProcessBindings`'s
existing `At4dxCliError` paths (auth, org query, local scan, AT4DX-not-detected) are untouched.

One refinement: today the local path throws `at4dxNotDetected` when `records.length === 0`. With the
new scan shape, a source tree whose *only* `DomainProcessBinding` records are malformed returns zero
records but a non-empty `malformed` — AT4DX plainly *is* present, and saying it isn't would hide the
very problem worth reporting. The condition becomes `records.length === 0 && malformed.length === 0`,
matching what the CLI's own `validate` command already does. Such a scan renders as `data` with no
rows and an Issues section, not as `empty`.

## Alternatives considered

**A separate `AT4DX: Validate Domain Process Bindings` command.** Rejected. It would re-scan — the
only expensive part of the whole operation — to compute something we get for free from a scan we just
did. It also splits the model: the user would have "look at bindings" and "check bindings" as separate
acts, and would have to know to perform the second one. Since validation costs nothing, the useful
default is that you never have to ask.

**A `simply-at4dx.validate` setting to turn it off.** Rejected: a setting is warranted when a feature
costs something (0002's debug channel gates on one because it logs usernames and paths). This costs a
pure array pass and adds no privacy surface. A setting here would just be a second thing to explain.

**Push issues into VS Code's Problems panel as `vscode.Diagnostic`s.** The most idiomatic answer, and
genuinely tempting — squiggles on the offending `.md-meta.xml`, `F8` navigation, no custom UI. Rejected
for now on two counts. First, a `Diagnostic` needs a `Range`, and nothing upstream produces one:
`simply-aep-core` parses CMDT XML with SDR's `parseXmlSync`, which returns a plain object with no
positional information, so every issue would land on line 1 of the file — a squiggle that points at a
file rather than at the field that's wrong.
[0011's Alternatives](https://github.com/SimplySF/simply-node/blob/main/docs/design/0011-domain-process-binding-issue-scoping.md)
records the position-aware second parse this would need as explicitly out of scope. Second, an
org-sourced scan has no files at all, so half of this extension's data path could never populate the
Problems panel and the feature would appear and vanish depending on which source the user picked.
Worth its own doc once 0011's `filePath` exists and someone wants to size the ranged-parse work; the
panel is the surface that works for both sources today.

**Re-run `validateDomainProcessBindings` against the visible slice on every dropdown change.** The
literal reading of "validate what I'm viewing," and wrong: scan-scoped rules give different answers on
a slice, which is the entire subject of
[0011](https://github.com/SimplySF/simply-node/blob/main/docs/design/0011-domain-process-binding-issue-scoping.md).
It would also require the library inside the webview, which it can't be, or a round trip to the host
per dropdown change, which 0003 deliberately designed away.

**A separate "Issues" webview panel.** Rejected: it separates the problem from the thing it's about.
The value of validating here rather than in CI is that the broken binding is on screen next to its
badge; a second panel is just the CLI's table in a different window.

**Shell out to `sf simply aep at4dx domain-process-binding validate --json`.** Rejected — precisely
what [0006](0006-at4dx-direct-library-imports.md) removed, and it would re-add the `sf`-on-PATH
requirement this extension no longer has.

**Filter issues in the extension by hard-coding which rules are scan-scoped**, instead of waiting on
0011. Rejected: it puts rule semantics in a second repo and a second language, where a sixth rule added
upstream is silently mis-scoped with no failing test on either side. This is the drift
[0006](0006-at4dx-direct-library-imports.md) was written to end, and it isn't worth reopening to save
one upstream release.

## Implementation plan

Four stages, ordered so that each one compiles, runs, and could be reviewed on its own. Stage 1 is
behaviour-neutral; the feature becomes visible in Stage 2.

### Stage 0 — The upstream prerequisite, and what to do if it slips

Stages 2–4 need `@simplysf/simply-aep-core` at the version
[0011](https://github.com/SimplySF/simply-node/blob/main/docs/design/0011-domain-process-binding-issue-scoping.md)
ships in — expected `0.4.0`, for `scope`, `DOMAIN_PROCESS_BINDING_RULES`, and `filePath`. Stage 1 needs
only `0.3.0`, which is already published.

If 0011 slips and this extension has to ship first, Stage 1 plus a reduced Stage 2 works on `^0.3.0`:
with no `scope` field, treat **every** issue as scan-wide — a single Issues section, no `In {SObject}`
group, no "elsewhere" count in the summary bar. Less useful, never wrong, and it needs no rule
knowledge in this repo, so it does not reopen what _"Filter issues in the extension by hard-coding
which rules are scan-scoped"_ rejects above. Row badges are a pure identity join and work unchanged.
Prefer waiting for `0.4.0`; this is the fallback, not the plan.

### Stage 1 — Take the dependency, plumb issues through the host

No visible change: issues are computed and the panel ignores them. Reviewable as "the upgrade."

1. **`extensions/simply-at4dx/package.json`** — `@simplysf/simply-aep-core`: `^0.2.0` → `^0.4.0`.
   Regenerate `package-lock.json` with `npm install` at the repo root (npm workspaces; the lockfile is
   root-level). No other dependency changes.

2. **`src/at4dxCli.ts`** — three things at once, because the 0.3.0 scan-shape change and the new
   validate call touch the same lines:

   - Add to the dynamic-import destructure: `validateDomainProcessBindings`,
     `DOMAIN_PROCESS_BINDING_RULES`. Add `DomainProcessBindingIssue`,
     `DomainProcessBindingIssueRule`, `DomainProcessBindingRuleInfo`, and
     `DomainProcessLocalScanResult` to the `resolution-mode: 'import'` type import.
   - Replace the `let records: RawDomainProcessBindingRecord[]` local with a scan envelope. The org
     branch keeps its own `scanResult` local so it can check `.missing` before assigning:

     ```ts
     let scan: DomainProcessLocalScanResult; // DomainProcessOrgScanResult structurally satisfies this
     ```

   - **Absorb the 0.3.0 breaking change:** `scanLocalDomainProcessBindings(target.dirs)` returns
     `{ records, malformed, ambiguous }`, not a bare array — assign the envelope instead of an array.
   - **Change the local `at4dxNotDetected` condition** from `records.length === 0` to
     `scan.records.length === 0 && scan.malformed.length === 0`, matching what `simply-aep`'s own
     `validate` command does. A tree whose only bindings are malformed plainly _has_ AT4DX, and saying
     it doesn't would hide exactly the problem worth reporting.
   - **Validate before filtering**, and return the wider result:

     ```ts
     export type DomainProcessBindingScan = {
       rows: DomainProcessBindingRow[];
       issues: DomainProcessBindingIssue[];
       /** `DOMAIN_PROCESS_BINDING_RULES`, forwarded so the panel needs no import of an ESM-only package. */
       rules: Record<DomainProcessBindingIssueRule, DomainProcessBindingRuleInfo>;
     };

     // …after the scan, before any SObject filtering — 0011's validate-then-filter rule:
     const issues = validateDomainProcessBindings(scan);

     const sobjectFilter = sobjects?.length ? new Set(sobjects) : undefined;
     const filteredRecords = sobjectFilter ? scan.records.filter((r) => sobjectFilter.has(r.sobject)) : scan.records;

     summary(`ok, ${issues.length} issue(s)`);
     return { rows: resolveDomainProcessBindings(filteredRecords), issues, rules: DOMAIN_PROCESS_BINDING_RULES };
     ```

     The ordering is load-bearing even though `sobjects` is `undefined` at every call site today (see
     Open questions): writing it filter-then-validate would be a latent version of the bug 0011 fixes
     in the CLI, waiting for the first caller to pass a filter.

   - Re-export the `DomainProcessBindingIssue` type alongside the existing `DomainProcessBindingRow`
     re-export, so `domainProcessBindingPanel.ts` keeps importing its types from this file rather than
     growing its own `resolution-mode` import.
   - Extend the always-on summary log line with the issue count (above). The `label` stays
     `domain-process-binding list` or becomes `list+validate` — cosmetic, settle it in review.

3. **`src/extension.ts`** — the single call site:

   ```ts
   const { rows, issues, rules } = await getDomainProcessBindings(target, undefined, logger);
   if (rows.length === 0 && issues.length === 0) {
     DomainProcessBindingPanel.showEmpty();
     return;
   }
   DomainProcessBindingPanel.setData(rows, issues, rules);
   ```

   `showEmpty()` now requires both to be empty — a scan with no rows but real issues must render as
   `data`, or the malformed-only case reports "no bindings found" over the top of four errors.

**Stage 1 done when:** `npm run compile` is clean, and with `simply-at4dx.debug` on, the output channel
shows a non-zero issue count against fixture source with a known collision. The panel looks identical.

### Stage 2 — Render the issues

4. **`src/domainProcessBindingPanel.ts` — state and embedding:**

   - `PanelState`'s `data` variant gains `issues` and `rules`.
   - `setRows` → `setData(rows, issues, rules)`. It is no longer only rows; leaving the old name is how
     the next reader gets misled.
   - The panel starts retaining its last state (`private state: PanelState`, assigned in `render()`).
     Stage 3 needs it to resolve an issue index back to an issue; it is also just correct.
   - `buildDataScript` emits `ALL_ISSUES` and `RULE_INFO` next to `ALL_ROWS`, through the same `<`
     escaping — issue `message` strings embed record data (including `Description__c`), so they need
     exactly the `</script>`-safety the rows already get.

5. **Styles** — add to `SHARED_STYLE`: `.summary` (clean/problem variants), `.badge` plus
   `.badge.error` / `.badge.warning`, `.issues`, `.issue`, `.issue-meta`. All built from `--vscode-*`
   variables, matching everything already in that block. The existing `.collision` rule is deleted
   along with its badge.

6. **`CLIENT_SCRIPT`** — the substantive part:

   - Build the identity index once, outside `render()`:

     ```js
     const RECORD_KEY = (r) => r.developerName + ' ' + r.source;
     const ISSUES_BY_RECORD = new Map();
     for (const issue of ALL_ISSUES) {
       if (!issue.developerName) continue;
       const key = RECORD_KEY(issue);
       ISSUES_BY_RECORD.set(key, [...(ISSUES_BY_RECORD.get(key) || []), issue]);
     }
     ```

   - `rowHtml(row)` — replace the `collisionBadge` special case with
     `(ISSUES_BY_RECORD.get(RECORD_KEY(row)) || []).map(badgeHtml).join('')`. `badgeHtml` reads
     `RULE_INFO[issue.rule].title` for the label and `issue.message` for the `title` tooltip.
   - `render()` — compute `inView`/`elsewhere` per the Behavior snippet, then prepend the summary bar
     and append the Issues section around the existing `buildSections()` output.
   - Issue entries carry `data-issue-index` (their index in `ALL_ISSUES`) for Stage 3, and get the same
     click + Enter/Space handling `attachRowListeners` already gives rows — factor that handler so rows
     and issues share it instead of duplicating the listener block.

**Stage 2 done when:** the manual matrix below passes for everything except the two navigation rows.

### Stage 3 — Click an issue, open its metadata

7. **Message handler and host helper.** The webview posts `{ command: 'openIssue', index }` — an
   **index into `ALL_ISSUES`, not the file path**. The host looks up `this.state.issues[index]` and
   reads `filePath` from its own copy. Round-tripping a filesystem path through the webview and calling
   `vscode.Uri.file` on whatever comes back is a needless trust step when the host already holds the
   authoritative value. (`openClass` keeps passing a class _name_, which is a glob input rather than a
   path — left alone.)

   ```ts
   async function openBindingFile(issue: DomainProcessBindingIssue): Promise<void> {
     const uri = issue.filePath
       ? vscode.Uri.file(issue.filePath)
       : (await vscode.workspace.findFiles(`**/DomainProcessBinding.${issue.developerName}.md-meta.xml`, '**/node_modules/**', 1))[0];
     if (!uri) {
       void vscode.window.showWarningMessage(`Could not find the metadata file for ${issue.developerName}.`);
       return;
     }
     await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), vscode.ViewColumn.Beside);
   }
   ```

   The client renders the clickable affordance only for a local scan. The panel can know which, because
   `BindingSource.kind` already reaches `extension.ts` — pass it into `setData` rather than inferring it
   from `ALL_ISSUES.some((i) => i.filePath)`, which breaks on a local scan whose issues all happen to
   lack a path.

### Stage 4 — Fixtures, docs, release

8. **Fixtures** — commit a DX source tree with one deliberately-broken binding per rule plus several
   correct ones, so the manual matrix is reproducible by the next person instead of living in
   somebody's scratch directory. Put it at `extensions/simply-at4dx/testfixtures/` **and add
   `testfixtures/**` to `.vscodeignore`** — that file enumerates exclusions rather than inclusions, so
   an un-ignored new directory ships inside the `.vsix`.
9. **`README.md`** — a short subsection under Usage: validation runs automatically on every scan, what
   the summary bar / badges / Issues section mean, and that clicking an issue opens its metadata file
   for a local scan.
10. **Manual verification** — F5 into the Extension Development Host, run the full matrix below against
    the Stage 8 fixtures, and once against a real org for the org-path rows.
11. **Ship it** — one `feat(simply-at4dx):` commit (or PR squash) so `semantic-release-monorepo`
    path-filters it to this extension and cuts a minor: `2.0.0` → `2.1.0`. No `BREAKING CHANGE` footer —
    `engines.vscode` is untouched and nothing user-visible is removed. The dependency bump rides along
    rather than landing as its own `chore`, since on its own it would be a release with no behavior.
12. **Update this doc's `Status`** to `Implemented` with the PR link, and the row in
    `docs/design/README.md`'s index.

### What this does not touch

`extension.ts`'s source and org pickers, `logger.ts`, `esbuild.js`, `engines.vscode`, the activation
event, the `simply-at4dx.debug` setting, and the `loading`/`error` panel states are all unchanged. No
new command, no new setting, no new dependency — the whole feature is one extra library call plus
rendering.

## Testing

**Automated:** `npm run compile` (esbuild bundle plus `tsc --noEmit`) is the whole automated gate this
extension has — there is no unit test harness here, and this doc does not add one. CI runs exactly that
(`.github/workflows/ci.yml`). The validation logic itself is covered by unit tests in `simply-aep-core`
(0011's Testing section), which is the point of not reimplementing any of it here.

**Manual, in the Extension Development Host**, against the Stage 8 fixture tree — one deliberately
broken binding per rule, plus several correct ones, plus a second package directory so the
cross-directory cases are reachable:

| Case | What it checks |
| --- | --- |
| Clean source tree | `✓ No problems found`; no badges; no Issues section. |
| Two active same-type bindings tied on `OrderOfExecution__c` | Both rows badged `Order collision`; same information the panel renders today, now via the general mechanism. |
| `TriggerExecution` binding with blank `TriggerOperation__c` | Listed under `In {SObject}` as `Missing context field`, with the SObject still selectable — the case that renders in no section today. |
| Binding with neither SObject field set | Listed under `Elsewhere in this scan`; badges nothing. Confirms an issue with no row and no SObject still surfaces. |
| Same `DeveloperName` in two package directories, different SObjects | Listed under `Elsewhere in this scan` with both occurrences; **and** each occurrence badges its own row when that SObject is selected. This is the case that separates the identity join from the scope partition — if either is wrong, exactly one half of this row fails. |
| Both SObject fields set to different values | Warning-severity badge on the row; counted as a warning, not an error, in the summary bar. |
| An error under another SObject while the selected one is clean | Summary bar reports zero here and non-zero elsewhere, and the offending binding is listed under `Elsewhere in this scan` naming its SObject — the rule that keeps "no problems" honest. |
| Switching the SObject dropdown | Summary counts, badges, and both Issue groups all recompute; no round trip to the host (0003's model holds). |
| Source tree whose only bindings are malformed | Renders `data` with an Issues section, **not** the `empty` state, and not `at4dxNotDetected`. |
| Click an issue (local) | Opens the `.md-meta.xml` beside the panel — via `filePath`, and again with `filePath` stripped, to exercise the `findFiles` fallback. |
| Click an issue (org-sourced scan) | No clickable affordance; nothing thrown. |
| Org-sourced scan generally | Badges and both Issue groups render; no `filePath` anywhere. |
| A `Description__c` or message containing `</script>` | Panel still renders — the existing escaping now has to cover `ALL_ISSUES` and `RULE_INFO`, not just `ALL_ROWS`. |
| A rule slug with no `RULE_INFO` entry (simulate by deleting one before embedding) | Degrades to the raw slug rather than rendering `undefined` — cheap guard against a library that adds a rule before this extension's dependency range does. |

## Open questions

- **`getDomainProcessBindings`'s `sobjects` parameter is dead.** Every call site passes `undefined`;
  the panel has filtered client-side since 0003. The plan keeps it (and keeps validate-then-filter
  ordering around it) rather than deleting it, on the grounds that a host-side filter is the obvious
  shape for a future "validate only this SObject" entry point — but a reviewer who'd rather see it
  removed than carried is not wrong, and that's the call to make in Stage 1's review rather than later.
- **A host-side SObject filter would need `filterDomainProcessBindingIssues`.** If that parameter ever
  gets a real caller, the host must project issues through 0011's function, not grow a second copy of
  the client's two-property filter. Noted here because the temptation will be to copy the two lines.
- **No refresh.** The panel has never had one; re-running the command re-scans. Now that the panel
  reports correctness and not just content, "I fixed the metadata, re-check it" is a more natural
  thing to want. Out of scope here, but this is the feature that makes a refresh button worth
  designing.
- **A "show only bindings with issues" toggle** in the toolbar. Easy once `ALL_ISSUES` is embedded,
  deliberately not in this doc's first cut — the summary bar plus badges may well be enough, and the
  toolbar is two dropdowns wide already.
- **What happens when 0011's deferred rules land** (verifying `ClassToInject__c` and the SObject
  actually exist, from
  [0010's v2 list](https://github.com/SimplySF/simply-node/blob/main/docs/design/0010-at4dx-domain-process-binding-validate.md)).
  Those need I/O — a describe call or an Apex-class cross-reference — so validation stops being free
  and this doc's "always validate, no setting" reasoning stops holding automatically. Whoever adds them
  should revisit that decision here rather than inherit it.
- **0002's debug output channel** still logs a line labelled `domain-process-binding list`. Its
  open question in [0006](0006-at4dx-direct-library-imports.md) — what "debug" means with no subprocess
  — is now slightly larger, since the channel would also be the natural place to dump the full issue
  list. Still out of scope; still wants its own doc.
