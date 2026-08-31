# 0017 — AT4DX Bindings Redesign

**Status:** Planned (Stage 1 implemented, pending PR/review; Stages 2–4 not started)
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-31

## Problem

[0016](0016-at4dx-application-factory-binding-explorer.md) shipped the Application Factory explorer as
flat type-sections (one list each for Service, Selector, Domain, Unit of Work) and deliberately deferred
three things as future work: SObject-grouped cards (0016's own "Open questions", resolved-for-later),
field set inclusions (`SelectorConfig_FieldSetInclusion__mdt`), and drag-and-drop reordering (0016 shipped
a Sequence *field* instead, citing HTML5 drag-and-drop's missing keyboard equivalent).

A Claude Design canvas (`AT4DX Bindings Redesign.dc.html`, 6 turns, 19 options, fully extracted and
reconciled against the shipped `@simplysf/simply-aep-core` v0.9.0 API before this doc was written) now
specs out all three, plus a tab restructure (Service bindings move to their own tab, out of a combined
"Application Factory" tab) and a shared create/edit drawer component reused across every binding type
including Domain Process. This doc is that canvas reconciled into an implementable, staged plan — per
`docs/design/README.md`'s process, agreed here before any of it is built.

**Load-bearing finding from that reconciliation:** the canvas's create/edit drawer mockups (Turns 2, 3,
5) consistently show an **Active checkbox** and a **Delete binding** button on Service/Selector/Domain/
Unit of Work forms. Neither exists in the shipped library. `RawBindingRecord`/`BindingFieldsInput` in
`at4dxBindingTypes.d.ts` have no `isActive` field for any Application Factory binding type — confirmed
independently by 0016's own "Three ways this explorer is not the Domain Process explorer": *"There is
no order, no active flag..."* — and neither `at4dxBindingTypes.d.ts` nor `at4dxDomainProcessBindingTypes.d.ts`
nor `at4dxFieldSetInclusionTypes.d.ts` exports any delete function, for any binding type, anywhere in the
library. This isn't a UI decision to make; it's copy the canvas specifies that the library cannot back.
See "Deviations from the canvas" below for the resolution.

## Decision

Build this as **four independently-landable stages**, each its own PR, mirroring 0016's own staging:

| Stage | Scope | Canvas source |
| --- | --- | --- |
| **1** | Tab restructure: split the "Application Factory" tab into **SObject Bindings** (Selector/Domain/UnitOfWork, card-per-SObject) and **Service Bindings** (its own list). Read-only — no drag yet, existing Sequence-field editing keeps working. | 1a, 5a |
| **2** | Shared create/edit drawer component, restyled per type (header/breadcrumb/RESULTING BINDING copy), reused for Service/Selector/Domain/UnitOfWork **and** Domain Process Bindings. | 2a–2c, 3a–3c, 4b, 4c, 5b, 5c |
| **3** | Drag-and-drop reordering on the SObject Bindings sheet, with a keyboard-operable equivalent (closes 0016's own deferred gap), plus a Save/Revert bar for batched pending moves. | 1a, 1b (folded in, not shipped as a separate view), 3f |
| **4** | Field set inclusions (`SelectorConfig_FieldSetInclusion__mdt`) nested in the Selector edit drawer. | 3a section 3, 3f |

Stage 1 is the whole navigational value (card-grouped-by-SObject is the thing 0016 punted on, and
Service getting its own tab stops it competing for space with Selector/Domain/UnitOfWork). Stages 2–4
are additive; 3 and 4 both assume 2's drawer shell exists, but are independent of each other.

**Domain Process Bindings' own drag-and-drop (canvas Turn 4a's band-drag)** is *not* a stage here — see
"Not in this stage" below.

### Deviations from the canvas

Per `docs/design/README.md`'s own instruction ("correct the doc wherever the implementation taught you
something better") and `SPEC-CONVENTIONS.md`'s rule that copy is the spec *unless* it's wrong — these are
the cases where it's wrong, reconciled against the real library:

1. **No Active checkbox on Service/Selector/Domain/UnitOfWork drawers.** The field doesn't exist.
   Dropped from every drawer in Stage 2. (Domain Process Bindings' own Active checkbox — 4b/4c — is real
   and unaffected; `DomainProcessBindingFieldsInput.isActive` exists.)
2. **No Delete binding button, on any type, anywhere.** No delete function is exported for Application
   Factory bindings, Domain Process bindings, or field set inclusions. Every "Delete binding" footer
   button in 3a/3b/3c/4c is dropped. A future doc can add one once the library grows a `deleteBinding`
   (tracked as a follow-up, not blocking this one).
3. **3b's "clearing Active strands the domain process bindings" warning doesn't apply** — there is no
   Active field to clear. Domain bindings have no deactivate path at all right now; the only way to
   change which class handles an SObject's domain logic is editing `To__c` directly (still fully
   supported) or leaving the binding in place.
4. **5b's "offer to deactivate the other" Service-binding-collision affordance is dropped**, for the
   same reason — there's nothing to deactivate. Creating a second active Service binding on an interface
   the library already resolves for, both stay live; the tie surfaces exactly as 5a already renders it
   (amber banner, RESOLVES TODAY / MAY WIN INSTEAD) rather than being something the drawer can pre-empt.
5. **1b does not ship as a separate/toggleable view.** Its three states — the amber `sequence-collision`
   banner, the grey unordered dash, and the per-card package label — fold directly into the Stage 1 card
   sheet (1a) instead: the banner renders between/across the colliding cards, "unordered — no sequence
   set" is 1a's own Unit of Work row text when a card has no sequence, and the package name already has
   a natural home in the card's per-binding "Package" the way `ApplicationFactoryRow.svelte` already
   renders `row.source` today.
6. **Developer Name stays locked (disabled) in every edit drawer, not editable-with-a-warning.** The
   canvas's 3a/3b/3c mockups show it editable with a "renaming creates a new record" hint; 3f itself
   flags this as an open question ("whether that is honest enough, or whether the field should be
   read-only until a real rename exists"). `updateBinding`/`setDomainProcessBinding` both locate a
   record *by* `developerName` — there is no atomic rename, so an editable field backed by
   delete-then-create is a real footgun (a mid-sequence failure leaves neither record). Keeping it
   locked, matching every drawer already shipped (`ApplicationFactoryForm.svelte`, `BindingForm.svelte`
   both already disable it in edit mode) is the safe default until the library grows a real rename.
7. **The Selector Priority field is not a gap** — 2a/3a both flag "Priority is missing here" as a known
   canvas gap, but `ApplicationFactoryForm.svelte` already renders it (`showPriority` includes
   `'Selector'`). No action needed; noted so nobody "fixes" something already shipped.

### Not in this stage

- **Domain Process Bindings' band drag-and-drop** (4a). The existing Order-number-field editing already
  covers the same write (`setDomainProcessBinding({ order })`); band-drag adds real complexity (a batch
  of sequential writes, 4a's own "the failure state needs its own design" note is an unresolved open
  question, not a settled one) for a UX upgrade over an already-working control. Revisit once Stage 3's
  SObject-sheet drag-and-drop (a single-row-at-a-time case) has shipped and proven the interaction
  pattern; band-drag is strictly harder (N writes per gesture) and shouldn't be the first place it's
  tried.
- **The "deactivate the other" Service-binding collision affordance** (5b) — see deviation 4.
- **Field set inclusion deletion** — the library has no delete; inclusions can be created and toggled
  `isActive` (Stage 4), never removed. The canvas's "✕ remove" affordance in 3a's inclusion list is
  reinterpreted as "set inactive," consistent with `IsActive__c` existing specifically for this and with
  Domain Process's own "deactivate, don't delete" precedent.
- **Platform Events tab** — never designed in the canvas; stays `Coming soon`.
- Everything Turn 6 (`6a`) describes is **already shipped**, unchanged: `BINDING_RULES`'s rule set,
  copy, and severities already match the canonical 7-rule (really 7-rule-family, 9-row) table the canvas
  reconciles it to. No action needed here beyond Stage 3's `sequence-collision` UI treatment.

## Behavior

### Tab strip (Stage 1)

`SObject Bindings | Domain Process Bindings | Service Bindings | Platform Events`, plus the existing
source label at the right edge. "Application Factory" as a combined tab is retired; its lazy-scan-on-
first-visit behavior (0016) carries over to both new tabs, sharing the *same* underlying scan
(`getApplicationFactoryBindings` already returns Service/Selector/Domain/UnitOfWork together — the split
is purely a rendering change, not a second scan) so switching between SObject Bindings and Service
Bindings never re-fetches.

### SObject Bindings sheet (Stage 1, card layout)

One card per SObject that has at least one Selector, Domain, or Unit of Work binding, in the order
`resolveBindings` already returns (stable across re-renders). Card header: SObject name (mono, bold), an
"N gap(s)" amber pill when the SObject has no Domain or no Unit of Work binding, right-aligned
`commits Nth · N bindings` caption once Stage 3 lands (Stage 1: just `N bindings`, no commit-position
claim until drag exists to make that number meaningful to *change*).

Card body — one grid row per binding, `grid-template-columns: 104px 1fr 150px 100px 92px 30px` (type
pill / class link / detail text / value+badge / status / edit icon), copied verbatim from 1a:

| Binding type | Detail column | Value+badge column |
| --- | --- | --- |
| Selector (may repeat) | `N field sets` | Priority value + `WINS`/`SHADOWED` badge (existing `ApplicationFactoryViewRow.resolution`) |
| Domain (bound) | `N process bindings` (count of Domain Process bindings for this SObject, cross-referencing the *other* explorer's scan) | — |
| Domain (gap) | amber "⚠ domain process bindings won't resolve" + right-aligned **Add** link (opens Stage 2's drawer, type=Domain, SObject fixed) | shorter grid, no value/status columns |
| Unit of Work | `Commits Nth — from this card's position` (Stage 1: static text using `commitPositions()`, already exists in `applicationFactoryView.ts`) | `seq NN` or `—` |
| Unit of Work (gap) | "Not bound" + **Add** link | — |

Field-set-inclusion sub-rows (Stage 4) nest under a Selector row exactly as 3a shows — deferred until
Stage 4 exists to populate them.

**Implementation note (Stage 1, landed):** 1a's row grid also carries a 6th "status" column (a green dot
+ "Active" per binding row). Deviation 1 already establishes there's no `isActive` field for any
Application Factory binding type — as shipped, that column is dropped entirely rather than kept as
permanently-empty space; the card row grid is `104px minmax(0,1fr) 150px 100px 30px` (five tracks: type
pill / class-or-status link / detail / value+badge / edit), and a gap row is `104px minmax(0,1fr) 30px`
(pill / message / Add). Selector's field-set count ("N field sets") is also blank as shipped — that data
isn't scanned until Stage 4.

The **+ New Binding** split button (1c) replaces the flat toolbar's plain button: primary action opens
the type-choice menu (Selector/Domain/Unit of Work, each with 1c's exact multiplicity copy), landing in
Stage 2's drawer with SObject empty (free-typed) — the same path that can create a brand-new card for an
SObject not yet on the sheet.

### Service Bindings tab (Stage 1, table layout — 5a)

`grid-template-columns: 1fr 16px 1fr 100px 88px 128px 30px` (Interface / → / Implementation / Priority /
Package / Resolution / edit). Reuses the *existing* `buildApplicationFactorySections`/`resolveRows`
output for `bindingType: 'Service'` — this is a rendering split, not new resolution logic. Tie banner
(amber, "⚠ `X`: both at priority `N` — ...") already exists as `.af-tie-banner`/`isTiedGroup` in
`ApplicationFactorySections.svelte`; moves as-is into the new `ServiceBindingsSection.svelte`. No red
anywhere on this tab, per 5a's own footer rule — ties, unresolved-class, and unbound-interface are all
advisory, never `validate` failures.

**"Interfaces with no binding" and "bound-but-class-not-found" rows (5a sections 2–3)** are new —
`resolveBindings`'s current output has no concept of "interface declared but never bound" (it only
returns records that exist). Confirm with the library whether a future version exposes declared-but-
unbound interfaces (e.g. from interface metadata scanning) before committing to this row type; if it
doesn't, Stage 1 ships without these two sections and they become a follow-up doc once the library grows
the necessary read. This is the one behavior in this doc not independently confirmed against
`simply-aep-core`'s current exports — flagged rather than assumed.

### Shared create/edit drawer (Stage 2)

One Svelte component (`BindingDrawer.svelte`, replacing today's split `ApplicationFactoryForm.svelte`/
`BindingForm.svelte` with a single component parameterized by binding family) rendering: header (verb +
record key), breadcrumb (entry point — sheet button, card's Add link, or row's edit icon), RESULTING
BINDING preview (pill hue per type, dashed=prospective/solid=exists — exact copy per canvas type
verbatim, see extraction), then 2–3 numbered sections depending on type (Selector 3, everything else 2,
Domain Process 3). Every section, field, hint, and validation message's copy comes from the canvas
verbatim (Turns 2–3, 4b–4c, 5b–5c), **minus** the Active checkbox and Delete button per the deviations
above.

CLI-shaped preview footer (monospace, e.g. `binding create --type selector --developer-name ... `) is
new — currently no drawer shows the command it maps to. Purely presentational (computed client-side from
the same payload the form already builds), no new host-side capability needed.

Binding-SObject-field acceptance states (3e, all 4) already match `BindingSObjectField.svelte` as
shipped — no change needed there.

### Drag-and-drop with a keyboard equivalent (Stage 3)

0016 shipped Sequence-as-a-field specifically because "native HTML5 drag-and-drop has no keyboard
equivalent." This stage closes that gap rather than reopening it: every card gets **both** a pointer
drag handle (`⣿`, HTML5 `draggable`) **and** a pair of keyboard-operable Move Up / Move Down icon buttons
next to it, `tabindex="0"`, `aria-label="Move Account earlier in the commit order"` etc. A move by either
input path is identical from that point on — both stage the same pending-change entry in the Save/Revert
bar, both are undoable by Revert, both fire the same `updateApplicationFactoryBinding({ sequence })` on
Save. A visually-hidden live region (`aria-live="polite"`) announces each move ("Account moved to 2nd of
4") so a screen-reader user gets the same feedback a sighted drag gets from the card's position changing.
This is a stricter bar than the canvas itself sets (which only draws the pointer interaction) but is the
direct, previously-identified fix for why 0016 didn't build this the first time.

Sequence-collision banner (folded in from 1b, deviation 5): renders as a full-width amber strip between
two adjacent cards sharing a `BindingSequence__c` value, exact copy: *"⚠ sequence-collision — two
records share `BindingSequence__c NN`. Both SObjects are registered; only their order relative to each
other is indeterminate."* Never blocks a drag or a save — `sequence-collision` is a warning, not an
error (Turn 6, already true today).

Save commit order batches every pending move into one `updateApplicationFactoryBinding` call per moved
card, sequentially, stopping on the first failure and reporting which cards saved and which didn't (the
same "no designed recovery" gap 4a flags for band-drag applies here at a smaller scale — one row per
gesture rather than N — so a partial-failure UI is tractable: show a per-card status in the pending-
changes list rather than an all-or-nothing dialog).

### Field set inclusions (Stage 4)

Nested list under a Selector row in the edit drawer (3a section 3), backed by the library's
`scanLocalFieldSetInclusions`/`scanOrgFieldSetInclusions`/`createFieldSetInclusion`/
`updateFieldSetInclusion` (already shipped, confirmed against `at4dxFieldSetInclusionTypes.d.ts`). Add:
combobox + Add button, writing `createFieldSetInclusion({ sobject, fieldsetName })` scoped to the card's
SObject. Remove (✕): `updateFieldSetInclusion({ isActive: false })`, not a delete (see deviation/"Not in
this stage" above) — rendered as removed from the list rather than shown crossed-out, since an inactive
inclusion contributes nothing and showing it would contradict the "queries against this SObject use
these field sets" framing. `FieldsetName__c` uniqueness is **org-wide** (per 3f), so the combobox's
duplicate check must run against the *whole* scan's inclusions, not just this SObject's.

## Alternatives considered

**Shipping 1b as a real second view (a view-mode toggle on the SObject Bindings tab).** Rejected — the
canvas's own framing ("a different workspace... don't read the rows against that sheet") reads as
documentation of hard-to-screenshot states, not a proposed shipping surface, and every state it shows has
a natural home inside 1a's cards (deviation 5). A flat table view remains an easy follow-up if real usage
shows the card layout is hard to scan at 20+ SObjects.

**Implementing the canvas's Active/Delete affordances against `force`-only writes (i.e., faking
deactivation by setting some other field, or faking delete by writing an empty record).** Rejected —
both would be silent misuse of fields for a purpose AT4DX itself doesn't define, indistinguishable from a
bug to a future reader of the `.md-meta.xml`. Dropping the affordances and waiting for real library
support is the honest option, consistent with 0016's own precedent (shipping Sequence-as-a-field rather
than faking drag-and-drop with no keyboard path).

**HTML5 drag-and-drop alone, matching the canvas exactly, keyboard gap included.** Rejected for the
reason 0016 already gave it — considered and explicitly not repeating that regression now that a
keyboard-equivalent design exists to pair with it.

**Building Domain Process band-drag (4a) in the same stage as SObject-sheet drag (Stage 3).** Rejected —
band-drag's own canvas turn flags its failure-recovery UI as undesigned; shipping the simpler single-row
case first (Stage 3) and revisiting band-drag once that pattern is proven in the wild is lower-risk than
designing both interaction models' failure recovery at once.

## Implementation plan

Files, in the order they'd be written per stage. Component/type names are proposals, not final —
adjust during implementation where an existing name reads better.

**Stage 1 — tab restructure + SObject Bindings cards + Service Bindings tab**

1. `src/webview/lib/sobjectBindingsView.ts` — new: groups `At4dxBindingRow[]` by SObject into card
   data (gap detection, per-card binding list in Selector→Domain→UnitOfWork order), reusing
   `resolveRows`/`commitPositions` from `applicationFactoryView.ts` rather than duplicating them.
2. `src/webview/SObjectBindingCard.svelte`, `SObjectBindingsSheet.svelte` — new.
3. `src/webview/ServiceBindingsSection.svelte` — new, extracted from `ApplicationFactorySections.svelte`'s
   existing Service-type rendering + tie-banner logic.
4. `src/webview/App.svelte` — tab strip becomes 4 tabs; route SObject Bindings / Service Bindings as two
   views over the one `applicationFactory` scan.
5. Retire `ApplicationFactorySections.svelte`/`ApplicationFactoryRow.svelte`/`UnitOfWorkSections.svelte`
   once their content has moved into the two new views (or keep `ApplicationFactoryRow.svelte` if the
   card's binding rows reuse its grid — decide during implementation).

**Stage 2 — shared drawer**

6. `src/webview/BindingDrawer.svelte` — new, replacing `ApplicationFactoryForm.svelte` and
   `BindingForm.svelte`'s rendering (both keep posting the same `submitBinding`/
   `submitApplicationFactoryBinding` messages — no host-side change).
7. `src/webview/lib/bindingDrawerCopy.ts` — new: per-type header/breadcrumb/RESULTING BINDING/CLI-preview
   string builders, so the copy (verbatim from the canvas) lives in one tested module instead of inline
   in the component.
8. Delete `ApplicationFactoryForm.svelte`; fold `BindingForm.svelte`'s Domain-Process-specific fields into
   `BindingDrawer.svelte`'s type-conditional sections.

**Stage 3 — drag-and-drop**

9. `src/webview/lib/dragReorder.ts` — new: pure pending-move state machine (stage a move, compute new
   sequence, revert, commit order) so drag/keyboard/tests all drive the same logic.
10. `src/webview/SObjectBindingCard.svelte` — add drag handle + Move Up/Down buttons + live region.
11. `src/webview/PendingChangesBar.svelte` — new (Save/Revert footer bar).
12. `src/at4dxExplorerPanel.ts` — batch-sequential `updateApplicationFactoryBinding` calls for a commit,
    partial-failure reporting.

**Stage 4 — field set inclusions**

13. `src/applicationFactoryCli.ts` — add `getFieldSetInclusions`/`createFieldSetInclusion`/
    `updateFieldSetInclusion` wrappers, mirroring the existing binding read/write wrapper pattern.
14. `src/webview/FieldSetInclusionList.svelte` — new, nested in `BindingDrawer.svelte`'s Selector-only
    section 3.
15. `src/at4dxExplorerPanel.ts` — new `submitFieldSetInclusion` message handler.

**Docs, per stage**

16. Update this doc's Status line per stage as it lands (`Planned` after Stage 1, `Implemented (PR #N)`
    once Stage 4 does — matching 0016's own convention for a doc spanning multiple PRs).
17. `extensions/simply-at4dx/README.md` — rewritten Usage section once Stage 1 lands (tab names change
    user-visibly).

## Testing

Mirrors 0016's split between derivation unit tests and component tests; new surface area per stage:

- **Stage 1**: `sobjectBindingsView.test.ts` — gap detection, card ordering stability across re-scans, a
  Domain "not bound" gap never appears for an SObject with no Selector/UnitOfWork either (i.e. gap
  detection is genuinely per-binding-type-presence, not "card exists therefore assume all 3 gaps").
  `SObjectBindingCard`/`ServiceBindingsSection` component tests for each row state table above.
- **Stage 2**: `bindingDrawerCopy.test.ts` — every type's header/breadcrumb/RESULTING BINDING string,
  asserted verbatim per `SPEC-CONVENTIONS.md`'s "copy is the spec" rule. Confirm no `isActive`/delete
  affordance renders for any Application Factory type.
- **Stage 3**: `dragReorder.test.ts` — stage/commit/revert transitions, sequence recomputation, a
  collision (two cards sharing a sequence) never blocks staging or saving. Partial-failure path: second
  of three saves throws, first stays saved, third never attempted, all three states visible in the bar.
- **Stage 4**: field-set-inclusion create/toggle round trip against `testfixtures/`; org-wide (not
  per-SObject) duplicate-`FieldsetName__c` check.
- **Manual** (F5), each stage: confirm the tab strip / card sheet / drawer / drag / inclusions against
  `testfixtures/`, plus one connected-org pass per stage before it's marked `Implemented`.

## Open questions

- **5a's "declared but unbound interface" / "bound to a class that no longer exists" rows** — not
  confirmed buildable against the current library (see Behavior's Service Bindings section). Resolve
  before Stage 1 implementation reaches that part, or ship Stage 1 without them and file a follow-up.
- **Rename** (deviation 6) — deliberately left locked here; revisit once/if the library grows an atomic
  rename. Not blocking.
- **Domain Process band-drag** (4a) — deferred, not designed; its own "failure state needs its own
  design" note stays unresolved until someone picks it up as a dedicated follow-on doc.
- **Whether Stage 1 ships all four grid states in one PR or splits further** (e.g. cards-read-only first,
  gap/Add-link affordances second) — a call for whoever implements it, given the 920px/560px mockups
  bundle a lot into "Stage 1"; splitting further is fine as long as each split keeps the doc's own
  card-row-state table intact end to end before being called done.
