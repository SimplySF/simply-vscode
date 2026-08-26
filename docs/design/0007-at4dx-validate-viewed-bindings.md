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
| **Summary bar** (top of panel, above the dropdowns) | `✓ No problems found` when the scan is clean; otherwise `⚠ N errors · M warnings` with the counts split into *in this SObject* and *elsewhere in this scan*, so a user filtered to `Account` is never told everything is fine while three bindings are broken under `Contact`. Clicking it scrolls to the Issues section. |
| **Per-row badge** | One chip per record-scoped issue on that row, labelled with the rule's `title` from `DOMAIN_PROCESS_BINDING_RULES`, coloured by `severity` (`--vscode-editorError-foreground` / `--vscode-editorWarning-foreground`), with the issue's `message` as its `title` tooltip. The existing hand-written `⚠ order collision` badge is deleted and becomes one instance of this general mechanism — same appearance, now driven by the issue list instead of `row.orderCollision`. |
| **Issues section** (below the binding sections) | Every issue for the current selection, in one list: record-scoped issues for the selected SObject, then scan-wide issues under a `Scan-wide` subheading. Each entry shows severity icon, rule title, `developerName`, `source`, and message. This is the only place a `missing-sobject-reference` binding ever appears — it has no row and no SObject, so a section is the only surface that can hold it. |

Rows the panel currently drops on the floor stay dropped as *rows* — a blank-`TriggerOperation__c`
record still can't be filed under a trigger event, because there isn't one. It now shows up as an
issue naming it, which is the honest rendering: not "here is your binding," but "this binding is
declared and can never run."

### Selection and projection

The webview keeps doing its filtering client-side (0003's model — every row and now every issue is
embedded once, dropdown changes never round-trip to the host). The host embeds two arrays:

```js
const ALL_ROWS = [...];      // unchanged
const ALL_ISSUES = [...];    // DomainProcessBindingIssue[], the whole scan's issues
```

and the client's `render()` partitions on each issue's own `scope` field:

```js
const inScope = ALL_ISSUES.filter((i) => i.scope === 'record' && i.sobject === sobject);
const scanWide = ALL_ISSUES.filter((i) => i.scope === 'scan');
```

That two-line filter is why
[0011](https://github.com/SimplySF/simply-node/blob/main/docs/design/0011-domain-process-binding-issue-scoping.md)
stamps `scope` onto each issue instead of leaving it only in a lookup table: the webview is a separate
JS context that can't import the library, and the alternative is a copy of the five-rule scope mapping
maintained in plain JS in this file. The host still uses `filterDomainProcessBindingIssues` for its own
summary counts, so the library function is the definition and the client filter is a property check
against data the library stamped.

Badges join to rows on `(developerName, source)`, the key 0011 documents as unique per scan. Two
records sharing both — only reachable from two `--source-dir` roots with same-basename package
directories — would badge each other's rows; accepted, because that case *is* a
`duplicate-developer-name` error and both rows get that badge anyway.

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

1. **`extensions/simply-at4dx/package.json`** — bump `@simplysf/simply-aep-core` from `^0.2.0` to the
   version 0011 ships in (expected `^0.4.0`; 0.3.0 carried 0010's breaking scan-shape change, 0.4.0 the
   additive scoping API). Nothing else changes — no new dependency.
2. **`src/at4dxCli.ts`**:
   - Import `validateDomainProcessBindings` and the `DomainProcessBindingIssue` type alongside the
     existing scan/resolve imports, same dynamic-`import()` + `resolution-mode` pattern.
   - Absorb the `0.3.0` scan-shape change: `scanLocalDomainProcessBindings(dirs)` now returns
     `{ records, malformed, ambiguous }`; destructure instead of assigning a bare array. Keep the org
     path's existing `{ records, malformed, ambiguous, missing }` destructure.
   - Change the `at4dxNotDetected` condition on the local path to
     `records.length === 0 && malformed.length === 0`.
   - Change the return type from `DomainProcessBindingRow[]` to
     `{ rows: DomainProcessBindingRow[]; issues: DomainProcessBindingIssue[] }`. Validate the
     **unfiltered** scan, then apply the existing `sobjects` filter to records for `rows` only —
     validate-then-filter, per 0011.
   - Re-export the `DomainProcessBindingIssue` type next to the existing `DomainProcessBindingRow`
     re-export, so the panel keeps importing its types from this file.
   - Extend the summary log line with an issue count (`— ok, 3 issue(s)`); the label stays
     `domain-process-binding list` or becomes `list+validate` — cosmetic, decide in review.
3. **`src/extension.ts`** — one call site: destructure `{ rows, issues }`; keep `showEmpty()` only when
   both are empty; pass both to `DomainProcessBindingPanel.setRows(rows, issues)`.
4. **`src/domainProcessBindingPanel.ts`**:
   - `PanelState`'s `data` variant gains `issues`.
   - `buildDataScript` emits `ALL_ISSUES` next to `ALL_ROWS`, through the same
     `</script>`-safe `<` escaping (issue messages embed record data and get the same treatment).
   - `SHARED_STYLE` gains `.summary`, `.badge.error`, `.badge.warning`, and `.issues` rules, all built
     from `--vscode-*` theme variables like everything already there.
   - `CLIENT_SCRIPT`: partition by `scope`; render the summary bar; render badges in `rowHtml` from the
     row's matched issues, deleting the `orderCollision` special case; render the Issues section;
     `postMessage({ command: 'openIssue', developerName, filePath })` on click.
   - Panel message handler gains the `openIssue` branch → new `openBindingFile(developerName, filePath)`
     helper beside `openApexClass`.
5. **`README.md`** — a short section under Usage describing the summary bar, badges, and Issues
   section, and stating that validation runs automatically on every scan.
6. **Manual verification** — F5 into the Extension Development Host against fixture source containing
   one binding per rule (see Testing).
7. **Update this doc's Status** to `Implemented` with the PR link, and add the row to
   `docs/design/README.md`'s index.

## Testing

**Automated:** `npm run compile` (esbuild bundle + `tsc --noEmit`) is the whole automated gate this
extension has — there is no unit test harness here, unchanged by this doc. The validation logic itself
is covered by unit tests in `simply-aep-core` (0011's Testing section), which is the point of not
reimplementing any of it here.

**Manual, in the Extension Development Host**, against a fixture DX source tree carrying one
deliberately-broken binding per rule plus several correct ones:

| Case | What it checks |
| --- | --- |
| Clean source tree | `✓ No problems found`; no badges; no Issues section. |
| Two active same-type bindings tied on `OrderOfExecution__c` | Both rows badged `Order collision`; matches the badge the panel renders today. |
| `TriggerExecution` binding with blank `TriggerOperation__c` | Appears in the Issues section as `Missing context field`, with the SObject still selectable — the case that renders in no section today. |
| Binding with neither SObject field set | Appears under `Scan-wide`; confirms an issue with no row and no SObject still surfaces. |
| Same `DeveloperName` in two `--source-dir`-equivalent package directories | Appears under `Scan-wide`; both occurrences listed. |
| Both SObject fields set to different values | Warning-severity badge on the row; counted as a warning, not an error, in the summary bar. |
| Filter to an SObject with no issues while another SObject has errors | Summary bar reports zero here and non-zero elsewhere — the counting rule that keeps "no problems" honest. |
| Source tree whose only bindings are malformed | Renders `data` with an Issues section, **not** the `empty` state. |
| Click an issue (local) | Opens the `.md-meta.xml` beside the panel. |
| Click an issue (org-sourced scan) | Not clickable; nothing thrown. |
| Org-sourced scan generally | Badges and Issues section render; no `filePath` anywhere. |
| A description or message containing `</script>` | Panel still renders — the existing escaping covers the new array. |

## Open questions

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
