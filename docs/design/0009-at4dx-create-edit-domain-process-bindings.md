# 0009 — Create & Edit Domain Process Bindings

**Status:** Draft
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-27

## Problem

`simply-at4dx` can show and validate `DomainProcessBinding__mdt` wiring ([0001](0001-at4dx-domain-process-binding-explorer.md),
[0007](0007-at4dx-validate-viewed-bindings.md)), but there's no way to act on what it shows. Adding a
binding, or fixing one the panel just flagged, still means hand-writing a
`DomainProcessBinding.<Name>.md-meta.xml` file from memory or clicking through Setup — the exact gap
[0012 in `simply-node`](https://github.com/SimplySF/simply-node/blob/main/docs/design/0012-at4dx-domain-process-binding-create-set.md)
closed at the library level, naming this extension as the reason it did: `@simplysf/simply-aep-core@0.5.0`
now exports `createDomainProcessBinding`/`setDomainProcessBinding`, `buildDomainProcessBindingXml`, and
`deployMetadataFile` — the write-side counterpart to the scan/resolve/validate functions this extension
already imports directly (0006). See that doc for the full field/validation/error contract; this doc only
covers what's specific to surfacing it here.

## Decision

Extend the existing "AT4DX Bindings" webview panel with a create/edit form, rather than adding a second
command or a separate panel. The panel already scans and validates the full binding set for whichever
source the user picked ([0001](0001-at4dx-domain-process-binding-explorer.md)'s QuickPick flow); a create
or edit is exactly a write against that same, already-in-memory context — the developer-name-collision and
order-collision checks `createDomainProcessBinding`/`setDomainProcessBinding` run need it anyway. Requiring
"view first" isn't friction added on top of the feature, it's the sequencing the write functions already
require.

Two new entry points into the panel, both opening the same form UI:

- **"+ New Binding"**, a toolbar button next to the SObject/Trigger Event dropdowns. Prefills `sobject`
  and, when the selected Trigger Event isn't "Domain Method Execution," `processContext`/`triggerOperation`
  from the panel's current dropdown selection — the common case is adding one more binding to the group
  someone is already looking at.
- **A pencil icon** on each row, next to (not replacing) the existing click-to-open-class behavior. Opens
  the same form pre-filled with that row's current values.

The form writes to whichever `BindingSource` produced the current scan — a local folder ("Local Source" or
"Choose Source Folder…") writes/updates a `.md-meta.xml` file there; a connected org deploys the write
directly, through a temp directory `simply-aep-core` manages internally (see 0012), never touching the
workspace. This mirrors the read side's existing one-source-per-panel-session scoping ([0001](0001-at4dx-domain-process-binding-explorer.md))
exactly — no new concept, just a write instead of a read against the same target. `simply-aep-core`'s
write functions actually support a third mode, writing local source **and** deploying to an org in the
same call (0012's "both allowed" flag rule) — deliberately not exposed here; see Alternatives considered.

Unlike the CLI (where `set` only changes the flags explicitly passed, preserving everything else), the
edit form is always fully pre-filled from the row being edited and always submits every field. There's no
"only what changed" concept to preserve when the whole record is already in front of the user editable —
this is simpler than diffing the form against the original row and behaviorally identical for a UI editor
(re-submitting an unchanged field's current value is a no-op).

On a successful write, the panel re-runs the scan for the current `BindingSource` (the same call
`showDomainProcessBindings` made to populate the panel originally) and re-renders, so the new/changed
record — and any issue it does or doesn't introduce — shows up immediately, without the user having to
manually re-trigger the command.

## Behavior

### Entry points

```
Panel toolbar          "+ New Binding" button   → form, mode: create, prefilled from current dropdowns
Row's pencil icon       (per binding row)        → form, mode: edit, prefilled from that row
```

### Form fields

One form for both modes; `developerName` is editable in create mode, read-only in edit mode (renaming is
out of scope — see 0012's Alternatives considered, which this extension inherits).

| Field | Control | Notes |
| --- | --- | --- |
| Developer Name | text | Create only. Client-side checked against `^[A-Za-z][A-Za-z0-9_]*$`, ≤40 chars, no consecutive/trailing underscore — the same rule the library enforces, checked here only to fail fast before a round trip. |
| Label | text | Defaults to Developer Name if left blank (matching the library default). ≤40 chars. |
| SObject | text | Free text, not a picklist — the panel has no describe/schema access, and a folder-scan or org-CMDT-query source doesn't imply object existence either. |
| Bind via alternate field | checkbox | `sobjectAlternate`. Off by default. Label copy explains it's for Setup objects (e.g. `ServiceResource`) that can't be referenced through the primary field — ported from 0012's Decision section. |
| Process Context | select | `TriggerExecution` \| `DomainMethodExecution`. Toggles which of the next two fields shows. |
| Trigger Operation | select | Shown only when Process Context is `TriggerExecution`. Options forwarded from `ALL_TRIGGER_OPERATIONS` (already imported from `simply-aep-core` for [0007](0007-at4dx-validate-viewed-bindings.md)'s dynamic import) rather than a second hardcoded list. |
| Domain Method Token | text | Shown only when Process Context is `DomainMethodExecution`. |
| Type | select | `Action` \| `Criteria`. |
| Class to Inject | text | Not validated against the workspace — same reasoning as SObject above; an org-only scan has nothing to check it against either. |
| Order | number | `OrderOfExecution__c`. Decimals allowed (AT4DX's Criteria/Action-within-a-slot convention). |
| Active | checkbox | Defaults on (matches the library default on create; carries the row's current value on edit). |
| Execute Asynchronously | checkbox | Default off. |
| Logical Inverse | checkbox | Default off. |
| Prevent Recursive | checkbox | Default off. |
| Description | textarea | Optional. |

Because the form's own conditional rendering only ever shows one of Trigger Operation/Domain Method Token
at a time and only ever submits the one that's visible, `error.contextFieldMismatch` (0012's Errors table)
isn't reachable through this UI — it stays in the error-code table below only as a defensive fallback.

### Submit flow

```
Save
  → client-side field checks (required fields, developer-name format, label length)
       fail → inline field errors, no request sent
  → createDomainProcessBinding(input, target) / setDomainProcessBinding(input, target)
       ok                  → close form, re-scan current BindingSource, re-render panel
       blocked (validation) → form stays open; blocking issues render inline (same badge/severity
                               styling as the panel's existing Issues section); Save button becomes
                               "Save Anyway"
       Save Anyway          → same call with force: true
       other error          → error banner in the form (message from the table below); form stays open
                               with entered values intact
```

`target` is resolved from the `BindingSource` already in hand — no new picker:

| `BindingSource.kind` | `create` target | `set` target |
| --- | --- | --- |
| `'source'` (Local Source / Choose Source Folder…) | `{ sourceDir: dirs[0] }` | `{ sourceDirs: dirs }` |
| `'org'` | `{ connection }`, built the same `AuthInfo.create` → `Connection.create` way `at4dxCli.ts`'s read path already does | same |

`dirs` is always exactly one entry today (`resolveDefaultSourceDir`/the folder-browse dialog both resolve
to a single directory — see [0008](0008-at4dx-default-source-folder.md)), so `dirs[0]` is never ambiguous
in practice; `set`'s `sourceDirs` accepts the same array as a (currently single-element) search scope
without change.

### Errors

`at4dxCli.ts` gains write wrappers that mirror `getDomainProcessBindings`'s existing translation pattern —
a `DomainProcessBindingWriteError`'s `code` becomes a message safe to show directly, except
`validation-failed`, which isn't an error condition the form treats as fatal (see Submit flow above):

| `DomainProcessBindingWriteErrorCode` | Handling |
| --- | --- |
| `validation-failed` | Not thrown as a fatal error to the caller — surfaced as the blocking-issues + "Save Anyway" state described above. |
| `developer-name-already-exists` (create) | Inline error under the Developer Name field: "A binding named "X" already exists in this source." |
| `developer-name-not-found` (edit) | Error banner: the record this form was opened for is no longer in the scanned source (e.g. deleted since the panel last scanned). Suggests re-running the command. Defensive — shouldn't happen in the normal click-pencil-icon-on-a-visible-row flow. |
| `deploy-failed` | Error banner, phrased to make clear the local file (if `sourceDir`/`sourceDirs` was also part of the target) was already written — only the org deploy failed — so the user doesn't think the whole write was rolled back. |
| `context-field-mismatch`, `invalid-developer-name`, `label-too-long`, `no-fields-to-update`, `at4dx-not-detected`, `source-or-target-required` | Generic error banner with the library's message. Not reachable through normal use of this form (form-side validation/full-resubmit/always-resolved-target rule each one out — see Behavior above) — kept only so a `DomainProcessBindingWriteError` this form didn't anticipate still surfaces a real message instead of throwing unhandled. |

Any other thrown error (network/auth failure building an org `Connection`, local filesystem I/O) is
wrapped the same way `getDomainProcessBindings` already wraps its own failures — an `At4dxCliError` with a
message safe to show, logged to the existing output channel ([0002](0002-at4dx-debug-output-channel.md)).

## Alternatives considered

**A multi-step QuickPick/`InputBox` wizard** (one prompt per field), matching this extension's existing
scope-selection flow (workspace → source → SObject → trigger event). Rejected: that flow works because
it's 2–4 short, mutually-exclusive-choice steps. This form has 14 fields, several with cross-field
show/hide behavior (Process Context gating Trigger Operation vs. Domain Method Token) and inline
validation-issue feedback (the blocking-issues + Save Anyway state) that a linear QuickPick chain can't
represent — the user would step forward through a dozen prompts with no way to see or revise an earlier
answer without restarting. The existing webview already solves the "themed, scriptable surface with
real layout" problem for the read side; a form is more of the same infrastructure, not new infrastructure.

**A separate command and/or separate panel for create**, instead of a toolbar button in the existing
panel. Rejected: `createDomainProcessBinding` needs the same scanned context (for the collision checks) a
fresh command would have to re-scan anyway, and a user adding a binding almost always already has a reason
to be looking at the panel — either they're mid-review of an SObject's pipeline, or they got here from
[0007](0007-at4dx-validate-viewed-bindings.md)'s validation summary. A separate entry point would either
duplicate the workspace/source picker or need its own way to reuse the current panel's scan; folding it
into the panel needs neither.

**Exposing `simply-aep-core`'s local-and-org "both at once" write mode** (0012's Decision: `--source-dir`
and `--target-org` aren't mutually exclusive for a write) as a form option — e.g. an "also deploy to this
org" checkbox available while editing a local source. Deferred, not rejected outright: the panel's
one-`BindingSource`-per-session scoping ([0001](0001-at4dx-domain-process-binding-explorer.md)) means a
single scan session never has both a set of local dirs and a connected org in hand at the same time today,
so offering the checkbox would mean either scanning a second target just to enable it, or picking an org
up front "just in case" even for someone who only ever wants local edits. Worth a follow-up once there's a
concrete request for it — the library-level support already exists and this doc's target-resolution table
extends cleanly to a third row if that happens.

**Diffing the edit form against the original row and submitting only changed fields**, matching the CLI's
`set` semantics exactly. Rejected: the CLI's partial-update model exists because a flag not passed has no
value to diff against — the terminal doesn't know the record's current state. The form always starts fully
populated from a live scan, so every field already has a known, visible value; submitting all of them is
simpler code and behaviorally identical to a partial update where every field happens to be "changed" (to
its current or a new value). See Decision.

## Implementation plan

1. **`extensions/simply-at4dx/package.json`** — bump `@simplysf/simply-aep-core` from `^0.4.0` to
   `^0.5.0`. Per [0006](0006-at4dx-direct-library-imports.md)'s Open Questions, this package's pre-1.0
   surface isn't pinned loosely by default — this is a deliberate version bump for the new write exports,
   not a range widening.
2. **`src/at4dxCli.ts`**:
   - Add to the dynamic-import destructure: `createDomainProcessBinding`, `setDomainProcessBinding`,
     `DomainProcessBindingWriteError`, plus the input/result/error-code types from the barrel
     (`CreateDomainProcessBindingInput`, `SetDomainProcessBindingInput`, `CreateDomainProcessBindingTarget`,
     `SetDomainProcessBindingTarget`, `At4dxDomainProcessBindingWriteResult`,
     `DomainProcessBindingWriteErrorCode`, `ALL_TRIGGER_OPERATIONS` for the form's Trigger Operation
     options).
   - Factor the existing org-connection building (`AuthInfo.create` → `Connection.create`, currently
     inline in `getDomainProcessBindings`) into a small `resolveConnection(username)` helper, used by both
     the read path and the two new write wrappers — avoids duplicating that step a third time.
   - Add `createBinding(input: CreateDomainProcessBindingInput, target: BindingSource, logger?: Logger): Promise<WriteOutcome>`
     and `setBinding(input: SetDomainProcessBindingInput, target: BindingSource, logger?: Logger): Promise<WriteOutcome>`,
     where `type WriteOutcome = { kind: 'ok'; result: At4dxDomainProcessBindingWriteResult } | { kind: 'blocked'; issues: DomainProcessBindingIssue[] }`.
     Each: resolves `target` into a `CreateDomainProcessBindingTarget`/`SetDomainProcessBindingTarget` per
     the table in Behavior, calls the corresponding library function, catches
     `DomainProcessBindingWriteError`, returns `{ kind: 'blocked', issues: error.issues! }` for
     `code === 'validation-failed'`, and re-throws every other code as an `At4dxCliError` with the message
     from the Errors table above. Logs a summary line the same shape as `getDomainProcessBindings`'s
     (`... domain-process-binding {create,set} (<label>) — <ms>ms — <outcome>`).
3. **`src/domainProcessBindingPanel.ts`**:
   - `PanelState` gains a `'form'` variant: `{ kind: 'form'; mode: 'create' | 'edit'; initial: Partial<DomainProcessBindingRow>; blockedIssues?: DomainProcessBindingIssue[]; errorMessage?: string }`.
     The panel needs to retain the current `BindingSource`/`rows` alongside `'data'` so a form opened from
     it (and the re-scan after a successful save) has something to resolve against and return to; extend
     `setData`'s signature (or add a field on the `'data'` state) to carry the `BindingSource` that
     produced it, alongside `workspaceFolder`/`logger` the panel doesn't hold today (add as constructor
     params, passed from `extension.ts`'s existing `showDomainProcessBindings`).
   - Toolbar HTML: add the "+ New Binding" button next to the existing dropdowns (`buildDropdownsHtml`).
   - Row HTML (`rowHtml` in `CLIENT_SCRIPT`): add the pencil icon, a second `data-*`-driven click target
     alongside the existing row-body click (which keeps opening the class file, unchanged).
   - New form HTML/CSS (extending `SHARED_STYLE`) and `CLIENT_SCRIPT` logic: field rendering, the Process
     Context show/hide behavior, client-side checks, and postMessage `createBinding`/`setBinding`/
     `cancelForm` handlers — mirroring the existing `openClass`/`openIssue` message pattern
     (`panel.webview.onDidReceiveMessage`).
   - Host-side handling of those messages: call the new `at4dxCli.ts` wrappers, then either
     re-run `getDomainProcessBindings` and `render({ kind: 'data', ... })` (success), or
     `render({ kind: 'form', ..., blockedIssues })` / `render({ kind: 'form', ..., errorMessage })` to
     redisplay the form with its new state, keeping whatever the user had typed (the webview, not the
     host, owns the in-progress field values — only re-rendered sections change).
4. **`src/extension.ts`** — `showDomainProcessBindings` passes `workspaceFolder`/`target`/`logger` into
   `DomainProcessBindingPanel.setData` (or the panel constructor) per the point above; no new command
   registered (see Alternatives considered).
5. **`README.md`** — new "Creating and editing bindings" section under Usage, describing the two entry
   points, the "writes to whatever source you're viewing" scoping rule, and the Save Anyway flow. Update
   the Requirements section's `@simplysf/simply-aep-core` reference if it names a version.
6. **Manual verification** in a real Extension Development Host: create against local source, create
   against an org, edit a row of each kind, a developer-name collision on create, an edit that trips
   `order-collision` (confirm Save Anyway works and the new badge shows up after re-scan), a deploy
   failure against an org (confirm the local-file-was-written wording is accurate when both were given —
   not reachable yet per the deferred "both at once" alternative, but worth re-checking once that lands),
   and the alternate-SObject-field checkbox against a Setup object like `ServiceResource`.

## Testing

**Automated:** none checked into the repo — this extension has no test harness yet, the same gap every
prior `simply-at4dx` design doc has flagged, going back to
[0001](0001-at4dx-domain-process-binding-explorer.md). As a one-off verification (not committed —
`CLIENT_SCRIPT` is a plain string in `domainProcessBindingPanel.ts`, not a file a real test harness could
import), the extracted client script was run against a `jsdom` DOM built to match `buildShellHtml`'s
output, exercising: initial render, opening the create form with SObject prefilled from the toolbar
selection, client-side required-field validation blocking submission, a valid submission's exact
`submitBinding` payload shape (including `triggerOperation`/`domainMethodToken` mutual exclusivity), the
`writeBlocked` response flipping Save to "Save Anyway" and resubmitting with `force: true`, the
`writeError` response rendering with newlines converted to `<br>`, Cancel returning to the data view, and
the edit-icon's `stopPropagation` not also firing the row's open-class click. All checks passed. This
covers the webview's own logic; it does not touch the host side (`createBinding`/`setBinding`,
`submitBinding` in the panel class) or a real VS Code webview runtime — see Manual below for that gap.

**Manual:** the Implementation plan's step 6 list above is the actual test plan; no automated coverage
exists to substitute for it. Not yet run — this is what's blocking this doc's Status.

## Open questions

- **No automated test harness**, still — same standing gap as every prior doc in this extension. Tracked
  in [0010](0010-automated-test-harness.md), which also formalizes this doc's own ad hoc `jsdom`
  verification (see its Testing section) into a real, checked-in test.
- **"Both at once" local + org write** — deferred per Alternatives considered; revisit once there's a
  concrete request.
- **Suggesting the next `order` value** for a new binding in the currently-selected group (e.g. highest
  existing order + 10) instead of leaving it blank. A nice-to-have, not designed here — the form works
  correctly without it, just with one more field for the user to fill in by hand.
- **Deploy poll timeout (`wait`)** isn't exposed as a form field — the write wrappers use `simply-aep`'s
  own default (33 minutes, per 0012). Worth a setting if a long-poll org ever makes this a real complaint,
  not designed here.
- **Deleting a binding** — out of scope; `simply-aep-core` doesn't expose a delete function yet either
  (0012's own Open Questions), so there's nothing to wire up.
- **Creating the first binding from the `'empty'` panel state** (a valid source with zero resolvable
  bindings and zero issues) isn't wired up — "+ New Binding" is only enabled once a scan has produced
  `'data'`. `'empty'` doesn't currently carry the `BindingSource` a write would need; extending it to do
  so, purely to unlock this one case, wasn't judged worth it against v1's scope. A real, if narrow, gap:
  a project with `DomainProcessBinding__mdt` deployed but zero records yet can't add its first one from
  the panel today.
- **The Trigger Operation select's blank "— Select —" placeholder** exists only so a user can't
  accidentally ship "Before Insert" by never touching the dropdown — see Implementation notes below.

## Implementation notes (post-implementation)

A few places where implementing this taught something the design above didn't anticipate:

- **No host-tracked `'form'` `PanelState` after all.** The plan's Implementation plan step 3 proposed a
  `PanelState` variant for the form, rendered (and re-rendered on Cancel/blocked/error) the same
  full-HTML-replace way every other state transition already works. Writing it out, that would have meant
  a full webview reload — and a lost in-progress form — on every Cancel, and on every blocked/error
  response too (the very moments the user most needs their entered values to survive). Since the webview
  already holds every row in `ALL_ROWS`, opening/prefilling/closing the form needs nothing the host has
  that the client doesn't; only Save genuinely needs the host, because only the host can call
  `createBinding`/`setBinding`. The actual implementation keeps the form entirely client-side (a
  `renderForm`/`openCreateForm`/`openEditForm` set of functions swapping `#content`'s innerHTML, exactly
  like switching the SObject/Trigger Event dropdowns already does) and adds exactly one new message each
  direction: `submitBinding` (webview → host) and `writeBlocked`/`writeError` (host → webview, via
  `panel.webview.postMessage`, *not* a full `render()` — the point is precisely to update the open form in
  place without reloading it). A successful write is the one case that *does* still go through
  `render()`, since "show the fresh, post-write scan" is exactly what a full state transition already
  means. `DataState` (the `'data'` `PanelState` variant) is unchanged from the plan otherwise, just with
  `sourceKind: BindingSource['kind']` widened to `target: BindingSource` so a write has something to
  resolve against.
- **`ALL_TRIGGER_OPERATIONS` is not forwarded from `simply-aep-core`.** The plan called for forwarding it
  the same way `DOMAIN_PROCESS_BINDING_RULES` already is, to avoid a second hardcoded list. In practice,
  forwarding it would have meant either an async fetch inside what is otherwise entirely synchronous
  client-side form-opening code, or fetching it once up front in `getDomainProcessBindings`'s scan and
  threading it through `DataState` just to reach a form that may never open. `ALL_TRIGGER_OPERATIONS` is a
  fixed, 7-value list tied to Salesforce's own trigger-event model (not something `simply-aep-core` would
  casually change), and the panel's client script already hardcodes an equally fixed
  `TRIGGER_OPS_BY_FAMILY`/`FAMILY_ITEMS` for the read side — `TRIGGER_OPERATIONS`/`TRIGGER_OPERATION_LABELS`
  follow that same precedent rather than the `DOMAIN_PROCESS_BINDING_RULES` one, which is a genuinely
  higher-drift-risk table.
- **`writeErrorMessage`'s per-code copy table shrank to one special case.** The plan's Errors table wrote
  custom copy for most `DomainProcessBindingWriteErrorCode` values. In practice,
  `DomainProcessBindingWriteError`'s own `message` (checked directly in `simply-aep-core`'s source) is
  already written to be shown as-is — it's the exact text `simply-aep`'s CLI commands print — so
  re-deriving equivalent copy here would only drift from it over time. The implementation passes
  `error.message` straight through for every code except `deploy-failed`, which gets one clarifying
  sentence appended: since this extension never gives a write both a `sourceDir`/`sourceDirs` and a
  `connection` (see the deferred "both at once" alternative), a `deploy-failed` here always means the
  org-only path, where the write happened in a temp directory `simply-aep-core` deletes regardless of
  outcome — unlike the plan's original wording (written before this was confirmed), nothing is "already
  written locally" to reassure the user about in this extension's current scope.
- **`resolveConnection` was factored out of `getDomainProcessBindings`'s org branch**, not called out in
  the plan, so all three call sites (the read path and the two write functions) build a `Connection` the
  same way instead of duplicating `AuthInfo.create` → `Connection.create` a third time.
- **A dual-package-hazard cast was needed and wasn't anticipated.** `simply-aep-core` depends on its own
  `@salesforce/core` (`^8.30.0`) separately from this extension's (`^9.1.7`) — two different installed
  copies. `scanOrgDomainProcessBindings`'s `AepConnection` type (a `Pick` of just the methods it calls)
  already papered over this for the read path, but `CreateDomainProcessBindingTarget`/
  `SetDomainProcessBindingTarget` type `connection` as the *full* `Connection` class, which `tsc` treats as
  nominally incompatible with this extension's own `Connection` instance (their private fields differ by
  declaration, even though neither write path touches a private field). `asWriteConnection` in
  `at4dxCli.ts` is a single, explicit, documented `as unknown as` cast at the one boundary that needs it —
  see that function's comment for the full reasoning. Aligning the two `@salesforce/core` versions instead
  (so there's only one installed copy) would remove the need for it, but is a larger, riskier change
  (an 8→9 major bump for `simply-aep-core`'s own dependency, upstream in `simply-node`, not something to
  do as a side effect of this doc) than this doc's scope justifies.
- **Client-side required-field validation was tightened beyond the plan's field list.** Writing the form
  surfaced that a `<select>` always has *some* value — with no blank option, Trigger Operation would
  silently default to "Before Insert" if a user never touched it while creating a `TriggerExecution`
  binding, which is a wrong-data risk, not just a missing-required-field one. The implementation adds a
  blank "— Select —" option (selected by default) and requires an explicit choice, plus the equivalent
  required check for Domain Method Token — neither was in the plan's Form fields table.
