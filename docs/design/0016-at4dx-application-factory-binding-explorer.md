# 0016 — AT4DX Application Factory Binding Explorer

**Status:** Implemented (PRs [#36](https://github.com/SimplySF/simply-vscode/pull/36), [#37](https://github.com/SimplySF/simply-vscode/pull/37), and the stage-3 PR) — see "Implementation plan" for the one deliberate deviation: commit-order reorder ships as a Sequence field on the standard edit form, not drag-and-drop.
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-30

## Problem

The explorer tab strip shipped in [0014](0014-at4dx-explorer-tab-strip.md) with three tabs, two of
them inert: **Application Factory** and **Platform Events** both render as
`explorer-tab-inert` with a "Coming soon" label. The Application Factory bindings are the other half
of AT4DX's wiring — the four
`ApplicationFactory_{Service,Selector,Domain,UnitOfWork}Binding__mdt` Custom Metadata Types that
answer "which Apex class implements this interface / is the selector for this SObject / participates
in the shared Unit of Work". Today a developer answering any of those questions reads
`.md-meta.xml` files by hand, or drops to
`sf simply aep at4dx binding list` in a terminal and correlates its output against the panel that's
already open.

Everything needed to read and write them already exists in `@simplysf/simply-aep-core`, which this
extension already imports directly (see [0006](0006-at4dx-direct-library-imports.md)):

| Concern | Library surface |
| --- | --- |
| Read | `scanLocalBindings`, `scanOrgBindings`, `resolveBindings` |
| Diagnose | `validateBindings`, `BINDING_RULES` (nine rules) |
| Write | `createBinding`, `updateBinding`, `BindingWriteError` |
| SObject-field eligibility | `ENTITY_DEFINITION_STANDARD_OBJECTS`, `isCustomObjectApiName` |

Two upstream design docs landed after the panel design work started and materially change what the
UI is allowed to claim — simply-node's
[0015](https://github.com/SimplySF/simply-node/blob/main/docs/design/0015-at4dx-binding-validate-create-set.md)
(`validate`/`create`/`update` for Service/Selector/Domain) and
[0017](https://github.com/SimplySF/simply-node/blob/main/docs/design/0017-at4dx-binding-unit-of-work-write-support.md)
(the same three commands extended to UnitOfWork, plus two new rules). This doc is written against
both as shipped, not against the earlier assumption that UnitOfWork was read-only.

## Decision

Build the Application Factory explorer as a **second view inside the existing webview panel**, not a
second panel. The tab strip becomes real: the Application Factory tab gets a click handler, the
inert style is dropped from it, and `App.svelte` routes between two explorer components. Host-side,
`domainProcessBindingPanel.ts` generalizes into `at4dxExplorerPanel.ts` holding one `PanelState` per
explorer, and a new `applicationFactoryCli.ts` sits beside `at4dxCli.ts` with the same
"import the library, wrap errors as `At4dxCliError`, log a summary line" contract.

One panel because the two explorers share everything that's expensive or user-visible-global: the
`BindingSource` selection, the output channel, `retainContextWhenHidden`, and the source label
already rendered at the right end of the tab strip. Two panels would mean picking a source twice and
two entries in the editor tab bar for one question ("how is this org wired?").

The explorer ships in three stages, each independently landable and each with its own PR:

| Stage | Scope | Prototype |
| --- | --- | --- |
| **1** | Read-only list + Problems. No writes. | `12a`, `12b`, `13b`, `13c` |
| **2** | Create/edit for Service, Selector, Domain. | `12c` |
| **3** | UnitOfWork create/edit + commit-order reorder. | `13a`, `13b`, `13d` |

Stage 1 is the whole value of the feature for a developer who is only trying to understand an org.
Stages 2 and 3 are strictly additive to it and neither is blocked on the other, but 3 assumes 2's
Binding SObject field component exists.

### Three ways this explorer is *not* the Domain Process explorer

Worth stating up front, because the temptation to reuse `BindingRow.svelte`/`BindingSections.svelte`
is strong and wrong:

1. **The grouping key isn't an SObject.** A Service binding keys on an interface name
   (`BindingInterface__c`); Selector, Domain and UnitOfWork key on an SObject. So the toolbar's
   primary control is **Binding Type**, not SObject, and there is no equivalent of the
   `FamilyKey`/trigger-operation second control at all.
2. **There is no order, no active flag, and no recursion/inverse/async flags.** The Domain Process
   row's entire right half doesn't exist here. What replaces it is **Priority** (Service and
   Selector only) and a **Resolution** column stating whether this row is the one AT4DX resolves to.
3. **UnitOfWork has no winner at all.** Every record contributes; `resolveBindings` returns
   `effective: true` for all of them, ordered by `BindingSequence__c` ascending. Its section is a
   commit-order list, not a resolution list, and it renders with different columns from the other
   three.

## Behavior

### Command and entry point

No new command. `simply-at4dx.showExplorer` already opens the panel; the tab strip switches views
inside it. The Application Factory tab shows a count badge on the same rules the Domain Process tab
already does.

### Section layout

One section per binding type present in the scan, in the order **Service, Selector, Domain, Unit of
Work** — AT4DX's own conceptual order (what does the work, what reads, what owns, what commits), and
stable, so a section doesn't move between scans.

Service / Selector / Domain rows (`12a`):

| Column | Source | Notes |
| --- | --- | --- |
| Interface / SObject | `row.key` | Header reads `Interface` for Service, `SObject` otherwise. |
| → | — | Static separator glyph. |
| Implementation | `row.to` | Click opens the `.cls`, reusing `openApexClass`. |
| Priority | `row.priority` | Service and Selector only. Blank renders `—` and sorts lowest. Domain has no such field — the column is absent from the Domain section. |
| Package | `row.source` | Package directory name, or the org username. |
| Resolution | `row.effective` / `row.ambiguous` | See below. |

Unit of Work rows (`13b`):

| Column | Source |
| --- | --- |
| SObject | `row.key` |
| Sequence | `row.sequence`, or `—` |
| Commits | Computed position — `1st`, `2nd`… or `unordered — no sequence set` |
| Package | `row.source` |

### Resolution states

The one place the panel is most at risk of lying, and the reason the prototype was reconciled against
the library twice:

| State | Renders | When |
| --- | --- | --- |
| Effective | Green dot, `Effective` | `effective: true`, no tie. |
| Shadowed | Muted, `Shadowed` | `effective: false`. A higher `Priority__c` won. |
| Resolves today / May win instead | Amber, an **amber row banner**, `RESOLVES TODAY` on the winner and `MAY WIN INSTEAD` on the others | Two Service/Selector rows tie on `Priority__c`. |
| Ambiguous | Amber, `Ambiguous` | `row.ambiguous` — Domain only, which has no priority field to break the tie. |
| Always | Neutral, no resolution column at all | UnitOfWork. |

A priority tie is **amber, never red, and never an error**. There is no `validate` rule for it,
`resolveBindings` still names a winner, and `binding validate` exits zero. The UI's job is to say
"this is not deterministic — give one a higher priority", not "this is broken". Red is reserved for
the `error`-severity rules in `BINDING_RULES`.

### Problems

A Problems view driven entirely by `validateBindings`, one row per issue, grouped error-then-warning.
Nine rules exist; the panel renders whatever comes back and never invents a category:

| Rule | Severity | Applies to |
| --- | --- | --- |
| `missing-sobject-reference` | error | Selector, Domain, UnitOfWork |
| `ambiguous-sobject-reference` | error | Selector, Domain, UnitOfWork |
| `unsupported-entity-definition-object` | error | Selector, Domain, UnitOfWork |
| `unnecessary-entity-definition-alternate` | warning | Selector, Domain, UnitOfWork |
| `duplicate-to` | error | Service, Selector, Domain — **never** UnitOfWork |
| `duplicate-domain-sobject` | error | Domain |
| `duplicate-unit-of-work-sobject` | error | UnitOfWork |
| `sequence-collision` | warning | UnitOfWork |
| `duplicate-developer-name` | error | all four |

Title and summary copy come from `BINDING_RULES[rule]`, forwarded through the host the same way
`DOMAIN_PROCESS_BINDING_RULES` already is — the webview never imports the ESM-only package.

`missing-sobject-reference` records are the interesting case: they're excluded from `records`
entirely, so they appear **only** in Problems and in no section. The Problems view is the sole place
they're visible, which is worth a line of copy rather than leaving the user to wonder why a file they
can see isn't listed.

### Binding SObject field (stage 2, `12c`)

The field is a combobox over `ENTITY_DEFINITION_STANDARD_OBJECTS` ∪ any name containing `__`, with
four states:

| State | Treatment |
| --- | --- |
| Eligible standard object (`Account`) | Green confirmation; writes `BindingSObject__c`. |
| Any `__` name (`Widget__c`) | Green; always eligible. Note that deploy still fails if it doesn't exist. |
| Ineligible standard object (`Task`) | Red, with an inline **"Use `Task` as an alternate name"** action that switches the write to `BindingSObjectAlternate__c`. Not blocked — the eligible-object list is explicitly best-effort and extended as real bindings confirm objects, so a hard block would be wrong. |
| Alternate holding an eligible object (`Contact`) | Amber `ALTERNATE ✕` chip; clearing it moves the value to the primary field. |

This is **not** an org SObject picklist. The gate is EntityDefinition metadata-relationship
eligibility, which is a static library table plus a `__` test — no org round trip, and it works
identically for a local-source scan.

### Unit of Work writes (stage 3, `13a`/`13b`)

`--type unit-of-work` is a real writable type as of simply-node 0017. The form has exactly three
fields, because the CMDT has exactly three: Developer Name, Binding SObject, and an optional Commit
Sequence. `to`, `priority` and `bindingInterface` are not hidden-but-tolerated — `createBinding`
throws `type-field-mismatch` for each, so the form must never send them.

**As shipped, reordering is a Sequence number field on the standard create/edit form, not
drag-and-drop.** HANDOFF-04 itself left the reorder interaction undecided ("whether the reorder
renumbers by tens or inserts fractional sequences" was an open question, not a settled design), and
native HTML5 drag-and-drop has no keyboard equivalent — a real gap in a panel that otherwise gives every
other interactive element `role`/`tabindex`/`onkeydown` treatment. Editing the Sequence field directly
is exactly how Domain Process's own `Execution_Order__c` is already reordered today (there is no
drag-to-reorder there either), so this keeps the two explorers' editing model consistent instead of
introducing a one-off bespoke widget for a single field. The live "resulting binding" preview computes
where the entered sequence would land (`previewCommitPosition`) against every other Unit of Work row
already in the scan, so the user sees the effect before saving. Revisit true drag-and-drop if editing
the number directly proves painful in practice.

A shared `BindingSequence__c` is `sequence-collision`, a **warning**. The consuming Apex
(`ApplicationSObjectUnitOfWorkDIProvider`) adds every resolved SObjectType with no throw, so both
SObjects still register and nothing is platform-broken — only the tied pair's relative order is
indeterminate. Two records with *no* sequence are never flagged; blank is the ordinary unordered
default.

### Errors

Same contract as [0009](0009-at4dx-create-edit-domain-process-bindings.md): a
`validation-failed` `BindingWriteError` becomes `{ kind: 'blocked' }` and posts `writeBlocked` back
to the still-open form, so the user can retry with `force: true` without losing typed input. Every
other code throws `At4dxCliError` and posts `writeError`.

## Alternatives considered

**A second webview panel.** Rejected: the source selection, output channel and retained context are
all panel-scoped, and the tab strip already exists specifically so a second explorer lands inside the
current panel. Two panels means the user answers "which org / which source dirs" twice for one
question.

**Reusing `BindingRow.svelte`/`BindingSections.svelte` with optional columns.** Rejected. Of the
Domain Process row's nine columns, exactly two (class-to-inject, package) survive; order, type,
async, recursion, logical inverse, status and badges have no counterpart. Making one component serve
both means every cell becomes conditional and neither list's grid is readable. `Icon.svelte`,
`IssueEntry.svelte`, `SummaryBar.svelte` and the shared CSS in `App.svelte` **are** reused as-is.

**Grouping by SObject with each SObject's selector/domain/UOW bindings nested under it** (prototype
`5a`/`6a`). Genuinely attractive — it's how a developer thinks about "how is Account wired" — but
rejected for the first release: Service bindings key on an interface and have no SObject to nest
under, so they'd need a separate section anyway, and the grouping hides the one comparison the
Priority column exists to make (two implementations of the *same* key, side by side). Revisit once
there's real data; see Open questions.

**Blocking the save when `BindingSObject__c` names an ineligible standard object.** Rejected:
`ENTITY_DEFINITION_STANDARD_OBJECTS` documents itself as a best-effort baseline that isn't fixed
across Salesforce releases. Blocking would make a stale table into a hard wall. An error plus the
alternate-field escape hatch is the right severity, and mirrors what `validate --force` already
allows.

**Treating a priority tie as an error.** Rejected — no `validate` rule produces it, so the panel
would be the only thing in the toolchain calling a passing scan broken. See Behavior.

## Implementation plan

Files, in the order they'd be written. Mechanics, exact signatures and CSS are in
`HANDOFF-04-application-factory-explorer.md`.

**Stage 1 — read-only**

1. `src/applicationFactoryCli.ts` — new. `getApplicationFactoryBindings(target, logger)` returning
   `{ rows, issues, rules }`, mirroring `getDomainProcessBindings`.
2. `src/at4dxExplorerPanel.ts` — `domainProcessBindingPanel.ts` renamed and generalized to hold two
   explorer states; `extension.ts` updated to call it.
3. `src/webview/types.ts` — add the Application Factory arm to `InitialState`.
4. `src/webview/lib/applicationFactoryView.ts` — new: sectioning, resolution-state derivation,
   commit-position computation, issue partitioning.
5. `src/webview/ApplicationFactoryRow.svelte`, `ApplicationFactorySections.svelte`,
   `UnitOfWorkSections.svelte` — new.
6. `src/webview/App.svelte` — tab strip becomes interactive; route between the two explorers; add the
   new grid/token CSS.

**Stage 2 — Service/Selector/Domain writes**

7. `src/webview/BindingSObjectField.svelte` — new, the four-state combobox.
8. `src/webview/ApplicationFactoryForm.svelte` — new.
9. `src/applicationFactoryCli.ts` — add `createApplicationFactoryBinding` /
   `updateApplicationFactoryBinding` with the same `WriteOutcome` contract.
10. `src/at4dxExplorerPanel.ts` — handle the `submitApplicationFactoryBinding` message.

**Stage 3 — UnitOfWork**

11. `ApplicationFactoryForm.svelte` — the `unit-of-work` branch (three fields, no `to`/`priority`), plus
    `previewCommitPosition` for the live "commits Nth of M" preview.
12. `UnitOfWorkSections.svelte` — an edit (pencil) affordance per row, opening the same form. Reordering
    is editing the Sequence field, not drag-and-drop — see Alternatives considered.

**Docs, per `docs/design/README.md`**

13. Move this doc to `docs/design/0016-at4dx-application-factory-binding-explorer.md`, add its row to
    the index table, and set the status line to `Implemented (PR #N)` when stage 3 lands. Set it to
    `Planned` when stage 1 does — a partially-implemented doc should not claim `Implemented`.
14. `extensions/simply-at4dx/README.md` — the new explorer's behavior.

## Testing

**Unit** (`test/webview/applicationFactoryView.test.ts`) — the derivations, which is where the real
risk is:

- Sections come back in `Service, Selector, Domain, UnitOfWork` order regardless of scan order, and a
  type with no records produces no section.
- Two Service rows tying on `priority` both come back flagged as a tie, with the `effective: true`
  one marked as the resolver.
- A blank `priority` sorts below an explicit `0`.
- UnitOfWork commit positions: `[10, 20, 30]` → `1st, 2nd, 3rd`; `[10, 20, 20]` → `1st`, then two
  rows sharing `2nd or 3rd`; no sequence at all → unordered, no position claimed.
- `sequence-collision` is derived from issues, not recomputed — two records with no sequence produce
  no collision.
- Issue partitioning keeps `scan`-scoped issues visible under any section filter (the
  [0011](https://github.com/SimplySF/simply-node/blob/main/docs/design/0011-domain-process-binding-issue-scoping.md)
  rule).

**Component** (`test/webview/ApplicationFactorySections.test.ts`, `UnitOfWorkSections.test.ts`,
`ApplicationFactoryForm.test.ts`):

- A tie renders the amber banner and both resolution chips; a clean pair renders `Effective` and
  `Shadowed` and no banner.
- The Domain section renders no Priority column; the Service section does.
- The UnitOfWork form renders no Implementation/Priority/Interface input in any state.
- Selecting `Task` in the Binding SObject field surfaces the alternate action, and taking it flips
  the payload's `sobjectAlternate` to `true`.
- A `writeBlocked` message keeps the form mounted with its values intact and shows the blocking
  issues.

**Host** (`test/extension.test.ts`, extended): switching explorer tabs re-renders without re-scanning
the other explorer, and a scan failure in one explorer doesn't blank the other.

**Manual** (F5 in the Extension Development Host), against `testfixtures/`:

- Local scan and org scan both populate all four sections.
- An org with no Application Factory bindings but with Domain Process bindings shows an empty
  Application Factory tab, not an error.
- Edit a Unit of Work binding's Commit Sequence field and save; confirm the written `BindingSequence__c`
  in the `.md-meta.xml` and that the list's commit-position labels update after the rescan.

## Open questions

- *(Resolved)* **Flat type sections (`12a`) or SObject-grouped cards (`5a`/`6a`)?** Stage 1 shipped
  flat sections, per this doc's own reasoning above. SObject-grouped cards remain the more interesting
  design and the prototype explored it first — worth revisiting once there's real usage data, but not
  blocking anything further.
- **Does the Application Factory explorer need its own SObject filter?** The Domain Process explorer
  is SObject-first because a trigger context is meaningless without one. Here the full list is short
  enough to show whole. Proposed: no filter in stage 1; add one if real orgs prove otherwise.
- *(Resolved)* **`testfixtures/` had no Application Factory records.** Added alongside stage 1 — see
  `testfixtures/README.md`'s Application Factory section for what each fixture exercises (a Service
  priority tie, distinct-priority Selectors, an ineligible `Task` SObject reference, a Domain
  duplicate-SObject collision, and a Unit of Work commit order with a sequence tie and an unsequenced
  record).
- **Field set inclusions** (`SelectorConfig_FieldSetInclusion__mdt`) are a separate CMDT family with
  their own command pair, their own rules table, and an `IsActive__c` flag. Prototype `9a` nests them
  under their selector. Deliberately out of scope here; wants its own doc.
- *(Resolved)* **Did `simply-at4dx.debug`'s output channel name still read "AT4DX Domain Process
  Bindings"?** Fixed in stage 1 — `formatWriteError`/`formatReadError`/the `simply-at4dx.debug` setting
  description, and `extension.ts`'s own `errorMessage`, all say "AT4DX Explorer" now, matching the
  channel `extension.ts` actually creates.
