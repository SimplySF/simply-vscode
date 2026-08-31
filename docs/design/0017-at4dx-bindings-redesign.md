# 0017 — AT4DX Bindings Redesign

**Status:** Implemented (Stage 1 in [PR #40](https://github.com/SimplySF/simply-vscode/pull/40), Stage 2 in [PR #41](https://github.com/SimplySF/simply-vscode/pull/41), Stage 3 in [PR #42](https://github.com/SimplySF/simply-vscode/pull/42), Stage 4 in [PR #43](https://github.com/SimplySF/simply-vscode/pull/43); review follow-ups in [PR #44](https://github.com/SimplySF/simply-vscode/pull/44), [PR #45](https://github.com/SimplySF/simply-vscode/pull/45), [PR #46](https://github.com/SimplySF/simply-vscode/pull/46))
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

**Correction (caught in review, post-#46):** Stage 1 landed the tab strip in the order it happened to be
written in code (`Domain Process Bindings | SObject Bindings | Service Bindings | Platform Events`)
rather than this section's own documented order. Fixed in `App.svelte` — SObject Bindings, the tab this
whole redesign is centered on, now leads the strip as specified above.

**Correction (post-#47):** the panel's *default* tab on open (`PanelState.active`, `at4dxExplorerPanel.ts`)
was never revisited when the strip itself was reordered — it stayed `'domainProcess'`, left over from
before this redesign existed. SObject Bindings is now the default (`initialPanelState()`'s `active:
'applicationFactory'`, paired with `App.svelte`'s own `afTab` already defaulting to `'sobject'`). Since
Application Factory scans lazily and previously only started on the user's first click into that tab (see
"SObject Bindings sheet" below), making it the *default* tab meant that click would never come —
`at4dxExplorerPanel.ts`'s `setData` (called once the eagerly-scanned Domain Process data resolves and
hands over the `BindingSource` `target` both scans need) now also starts the Application Factory scan
when it's the active tab, via a `triggerApplicationFactoryScanIfNeeded` helper shared with
`selectExplorer`.

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

**Correction (caught in review, post-#46):** what Stage 4 actually shipped for this cell was a
`fieldSetCountLabel` summary ("N field sets") in the Selector row's own detail column, not the nested
sub-rows this section calls for — a scope narrowing that was recorded in the Stage 4 implementation note
below but never reconciled back up against this paragraph's own spec. Fixed: `SObjectBindingCard.svelte`
now renders one `sb-fsi-row` per active field set inclusion, nested directly under the card's last
Selector row (inclusions are SObject-scoped, not tied to one specific Selector binding, so they nest once
per card regardless of `selectorCount`), each showing the field set's API name and source — matching 3a.
The Selector row's own detail column is blank again, the same as it was pre-Stage-4.

**Implementation note (Stage 1, landed):** 1a's row grid also carries a 6th "status" column (a green dot
+ "Active" per binding row). A gap row is `104px minmax(0,1fr) 30px` (pill / message / Add) — nothing to
show as active for a binding that doesn't exist yet. Selector's field-set count ("N field sets") was
blank as shipped in this stage — that data wasn't scanned until Stage 4.

**Correction (post-Stage-4, caught in review):** the status column was initially dropped outright,
reasoning that deviation 1's "no `isActive` field" finding meant there was nothing honest to show there.
That conflated two different things: an `isActive` field is something a form could *write* — and indeed
there's none to write, so the drawer never grew an Active checkbox (deviation 1 stands). But the status
column here is read-only and unconditional — every row reaching this component already came back from
`resolveBindings`, so it exists and resolves; there's no "inactive" *result* state for Selector/Domain/
Unit of Work to distinguish it from. The column is back (`SObjectBindingCard.svelte`, grid restored to
`104px minmax(0,1fr) 150px 100px 92px 30px`), rendering a static "Active" label on every real row,
matching 1a's own mockup — it was never actually in tension with deviation 1, just miscategorized under
it. Caught alongside a second, related bug in the same review: **WINS/SHADOWED (and the tie chips) were
rendering even for a solo Selector** with nothing to compete against — canvas 1a's own Fish__c example
shows no badge at all in that case, just the priority value. Both badge sets are now conditioned on the
card actually having more than one Selector row.

The **+ New Binding** split button (1c) replaces the flat toolbar's plain button: primary action opens
the type-choice menu (Selector/Domain/Unit of Work, each with 1c's exact multiplicity copy), landing in
Stage 2's drawer with SObject empty (free-typed) — the same path that can create a brand-new card for an
SObject not yet on the sheet.

**Implementation note (1c, landed after Stage 4):** when Stage 1 first shipped, this button stayed a
plain "+ New Binding" opening the drawer with no type preset (defaulting to whatever the drawer's own
segmented control defaults to) — a scope cut noted at the time as "Stage 2 work," but Stage 2's own scope
(the shared drawer copy) never actually included it, and neither did Stage 3 or 4. The real split
button/menu (`NewBindingMenu.svelte`) landed as its own follow-up once the gap was noticed in review,
with 1c's exact menu copy verbatim. The **Service Bindings tab keeps the plain (non-split) button**,
matching 5a's own footer note ("without the caret — since Service is the only binding type on this
tab") — only the SObject Bindings tab's button is a split button with a menu.

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

**Implementation note (Stage 2, landed):** shipped as a shared *copy library*
(`lib/bindingDrawerCopy.ts`), not a single physically-merged `BindingDrawer.svelte`. The five field-sets
(Service/Selector/Domain/UnitOfWork/Domain-Process) have almost nothing in common below the chrome —
different required fields, different validation, different payload shapes — so forcing them into one
component would mean a wall of `{#if bindingType === ...}` branches with no real duplication removed.
`ApplicationFactoryForm.svelte` and `BindingForm.svelte` stay separate components, each computing its
own `DrawerCopy` (title/breadcrumb/type pill/RESULTING BINDING/CLI preview) from the shared library and
rendering it through the same CSS classes (`.form-context-bar`, `.form-breadcrumb-bar`,
`.form-preview`, `.form-cli-preview`) — the *visual system* is shared and verbatim-tested
(`bindingDrawerCopy.test.ts`), which is what the canvas actually cared about; the component split is an
implementation detail the canvas doesn't speak to.

**Correction (post-Stage-2, caught in review):** two things shipped wrong relative to the canvas and
were fixed after the fact, once 1c's menu (above) made them visible in practice:

- **`ApplicationFactoryForm.svelte` kept the pre-canvas "Binding Type" segmented control**, letting a
  user switch Service/Selector/Domain/Unit of Work *inside* the drawer even after arriving via a specific
  entry point. No canvas mockup (2a–3c) shows one — every one of them treats the type as already decided
  by whichever entry point opened the drawer. Now that 1c's own type menu (see the correction below)
  makes the type explicit before the drawer ever opens, the control was removed outright; `bindingType`
  is a fixed value read from `initial.bindingType` once, not `$state`.
- **Both drawers rendered full-width, replacing the list entirely**, instead of the canvas's own
  520–560px floating panel (every one of Turns 2–4's mockups draws the drawer at that width, over the
  sheet, not stretched to it). Fixed by moving `<ApplicationFactoryForm>`/`<BindingForm>` out of the
  `#content` conditional into a `position: fixed` right-anchored `.drawer-panel` (`width: min(520px,
  100vw)`) with a `.drawer-backdrop` behind it — the list stays mounted and visible underneath rather
  than being unmounted while the drawer is open, and `#content` gets `inert` while a drawer is open so
  keyboard focus can't leak into now-hidden-behind-the-backdrop content. Clicking the backdrop cancels,
  same as the drawer's own Cancel/Discard button. This is a shared `App.svelte`-level change, not
  per-drawer — `BindingForm.svelte`'s own drawer got it too, even though 4b/4c's canvas turn wasn't the
  one that prompted the fix.

Two further scope cuts, both left for a later pass rather than blocking this one:

- **No "unsaved changes" dirty-state marker.** The canvas shows an amber dot once any field changes in
  edit mode (3a/3c/4c). Tracking dirtiness cleanly across every field in both forms is a real feature on
  its own, orthogonal to the copy/breadcrumb work this stage is about — revisit alongside a future editing
  pass rather than bolting it on here.
- **The RESULTING BINDING priority-competition sentence is a template, not a literal reproduction of the
  canvas's worked examples.** It's computed live from whatever's actually in the scan (via
  `priorityCompetition`), so it says the right thing for any data — but the specific class names in the
  canvas's own screenshots ("wins ... over `PremiumAccountsSelector`") are examples of the *shape*, not
  strings to hardcode. `bindingDrawerCopy.test.ts` asserts the shape against synthetic fixtures instead.

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

**Implementation note (Stage 3, landed):**

- **Sequence assignment is fractional/midpoint, not a full renumber per move.** `lib/dragReorder.ts`
  assigns the *moved* card a sequence strictly between its new neighbors' current values (e.g. dropping
  between `10` and `20` yields `15`) — so a single drag between two already-spaced cards produces exactly
  the "1 pending change" the canvas's own 1a footer shows, not a cascade touching every card after it.
  When there's no integer room (deeply nested drags) or a neighbor is itself unsequenced with nothing on
  the far side, the whole order rebalances onto a fresh `10, 20, 30, ...` ladder instead — a rarer,
  honestly-larger diff rather than a silent collision or a value overlapping an existing one.
- **Only cards with a real Unit of Work binding show drag/Move Up/Down controls.** A card with no Unit of
  Work binding at all has no sequence to reorder — that's what its own "Add" row is for (Stage 1). A card
  whose Unit of Work binding exists but has a blank sequence *does* participate, sorted after every
  sequenced one, exactly per 1b's "a drag onto a numbered row is what assigns it a position."
- **The partial-failure report is coarse, not a per-card badge list.** After `submitSequenceBatch`
  stops early, the host's response carries a saved count, a total count, and which SObject failed and
  why — not a full per-card saved/failed/not-attempted breakdown. Because a fresh rescan-and-render
  follows every batch (successful or not) and this architecture remounts the whole webview per state
  change (docs/design/0011), there is nowhere to keep a live per-card status list *anyway* — the
  freshly-mounted sheet's own re-seeded reorder state has no memory of which specific moves were never
  attempted, only what the disk/org now actually holds. `lastBatchResult` (a new one-render-only
  `InitialState` field, never persisted on `PanelState`) is the mechanism this uses to say what happened
  without inventing a second, no-remount message channel.
- **"Review N file edits" (1a's footer link) is dropped.** It implied a diff view over the affected
  `.md-meta.xml` files, which this stage has no read-side support for building.
- **The pending-changes bar's copy generalizes past 1a's own single-move example.** 1a's mockup only
  shows the exact copy for exactly one pending change ("1 pending change — SObjectName commits Nth, was
  Mth"); for more than one, `PendingChangesBar.svelte` keeps that same sentence for the count and adds a
  compact list, one line per pending card, since the canvas doesn't specify multi-move copy.
- **The keyboard equivalent is real, not a fallback stub.** Move Up/Down are ordinary buttons with
  `aria-label`s naming the SObject and direction, wired to the exact same `moveUp`/`moveDown` the drag
  handle's drop target calls — there is one reorder code path, not two. The drag handle itself is
  `aria-hidden` (mouse/pointer-only by design) since the buttons already cover the keyboard case.

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

**Implementation note (Stage 4, landed):**

- **Add/Remove write independently of the main Create/Save action, and never trigger a full panel
  re-render.** Every other write in this panel (a binding, a sequence batch) ends in a full rescan and
  `render()`, which remounts the whole webview (docs/design/0011) — fine when the write closes the form
  anyway, wrong here, since the canvas's own framing ("adding one here queues a second write; the
  selector is created either way") means the drawer needs to *stay open*. `at4dxExplorerPanel.ts`'s new
  `submitFieldSetInclusion` writes, re-scans only field set inclusions, patches the fresh list into
  `this.state.applicationFactory` in place (so the next unrelated render stays consistent) — but posts a
  **targeted** message (`fieldSetInclusionsUpdated` / `fieldSetInclusionBlocked` /
  `fieldSetInclusionError`) back to the still-mounted drawer instead of calling `render()`. The drawer
  keeps its own local copy of the inclusion list, seeded once and updated only by that message.
- **No combobox with real options — a plain text field.** The library has no way to enumerate an
  SObject's actual FieldSet API names (that's org-describe metadata `simply-aep-core` doesn't scan);
  "combobox" in the canvas's own copy is read as "a text field with an Add button," matching every other
  free-text field already in this drawer (class names, SObject names) rather than implying a live
  picklist this stage can't back.
- **No Developer Name field for a field set inclusion, by design, not by omission.** The canvas's own
  "Add" mockups (2a section 3, 3a section 3) never show one — just the field set name and an Add button —
  so one is generated (`suggestFieldSetInclusionDeveloperName`, `lib/fieldSetInclusionView.ts`): a
  sanitized `SObject_FieldSet_Inclusion` name, numerically suffixed on a collision. The user never sees
  or edits it.
- **No field count per field set** (the canvas's "6 fields"/"3 fields" in 3a's inclusion rows). The
  library exposes no FieldSet field-membership data at all — only the inclusion record itself
  (`fieldsetName`, `isActive`, source). Each row shows the field set's API name and its package/org
  source, nothing else.
- **No "1 will be created, 0 deleted" pending-diff summary** (3a's own footer note) — since Add/Remove
  write immediately rather than staging, there's nothing pending to summarize by the time the drawer
  would show one.

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

**Stage 2 — shared drawer copy (landed as a shared library, not a merged component — see the
Implementation note above)**

6. `src/webview/lib/bindingDrawerCopy.ts` — new: `applicationFactoryDrawerCopy`/`domainProcessDrawerCopy`,
   pure functions returning `{ title, breadcrumbLead, typePillLabel, typePillClass, breadcrumbSuffix,
   resultingBinding, cliPreview }`. `resultingBinding` is a `CopySegment[]` (plain/bold/mono), not a
   pre-formatted string with markdown-style markers — every segment can carry user-typed text (a class or
   SObject name), so it has to render through Svelte's own auto-escaping interpolation rather than
   `{@html}`, which would be an XSS opening. `priorityCompetition` is the shared live-resolution helper
   (wins/ties/shadowed) both `Service` and `Selector` copy uses.
7. `src/webview/ApplicationFactoryForm.svelte` — restyled header/breadcrumb/RESULTING BINDING/CLI-preview
   from `bindingDrawerCopy`; `existingUnitOfWorkRows` prop widened to `allRows` (the whole AF scan, so
   Service/Selector's competition sentence and Domain's process-binding count can be computed) plus a new
   `domainProcessRows` prop for that count.
8. `src/webview/BindingForm.svelte` — same restyle; the old separate `.form-scope-strip` ("Scope locked
   while creating:" + two pills) is retired in favor of the unified breadcrumb bar all drawers now share.

**Stage 3 — drag-and-drop (landed)**

9. `src/webview/lib/dragReorder.ts` — new: pure pending-move state machine (`initReorder`, `moveTo`/
   `moveUp`/`moveDown`, `revert`, `pendingChanges`, `positionOf`) so drag/keyboard/tests all drive the
   same logic. Fractional/midpoint sequence assignment, not a full renumber per move — see the
   Implementation note above.
10. `src/webview/SObjectBindingCard.svelte` — drag handle (`aria-hidden`, HTML5 `draggable`) + Move
    Up/Down buttons (the real keyboard equivalent) + the card-header commit-position caption.
11. `src/webview/SObjectBindingsSheet.svelte` — owns the `ReorderState`, wires drag/keyboard events, the
    live region announcing each move, the sequence-collision banner between colliding cards, and the
    batch-result banner.
12. `src/webview/PendingChangesBar.svelte` — new (Save/Revert footer bar).
13. `src/at4dxExplorerPanel.ts` — new `submitSequenceBatch` message: sequential
    `updateApplicationFactoryBinding` calls, stopping on the first failure/block; one rescan-and-render
    at the end carrying a one-render-only `lastBatchResult` (saved/total counts, which SObject failed).
14. `src/webview/types.ts` — `SequenceBatchUpdate`/`SequenceBatchResult`, and `InitialState.lastBatchResult`.

**Stage 4 — field set inclusions (landed)**

15. `src/applicationFactoryCli.ts` — `getFieldSetInclusions`/`createSelectorFieldSetInclusion`/
    `updateSelectorFieldSetInclusion`, mirroring the existing binding read/write wrapper pattern
    (dynamic `import()`, `BindingWriteError`-style `blocked`/thrown-error split — here
    `FieldSetInclusionWriteError`).
16. `src/webview/lib/fieldSetInclusionView.ts` — new: pure filtering/counting/grouping (there's no
    priority/resolution logic to derive here, unlike `applicationFactoryView.ts` — every active record
    contributes simultaneously) plus `suggestFieldSetInclusionDeveloperName`.
17. `src/webview/ApplicationFactoryForm.svelte` — new section 3 (Selector only): a local copy of the
    inclusion list, an Add row, and a Remove (✕) per row — landed inline in the existing component rather
    than a separate `FieldSetInclusionList.svelte`, consistent with Stage 2's "shared library, not a
    merged component" call; the section is small enough that splitting it out would be indirection, not
    reuse.
18. `src/webview/SObjectBindingCard.svelte`/`SObjectBindingsSheet.svelte` — the Selector row's "N field
    sets" text, previously always blank (Stage 1's own deferred-to-Stage-4 note), now reads from the
    scan's real inclusion count.
19. `src/at4dxExplorerPanel.ts` — new `submitFieldSetInclusion` message handler, and a shared
    `scanApplicationFactory` helper (bindings + field set inclusions together) every write handler now
    calls, replacing each one's own separate `getApplicationFactoryBindings` call.

**Docs, per stage**

20. Update this doc's Status line per stage as it lands (`Planned` after Stage 1, `Implemented (PR #N)`
    once Stage 4 does — matching 0016's own convention for a doc spanning multiple PRs).
21. `extensions/simply-at4dx/README.md` — rewritten Usage section once Stage 1 lands (tab names change
    user-visibly), and again once Stage 4 does.

## Testing

Mirrors 0016's split between derivation unit tests and component tests; new surface area per stage:

- **Stage 1**: `sobjectBindingsView.test.ts` — gap detection, card ordering stability across re-scans, a
  Domain "not bound" gap never appears for an SObject with no Selector/UnitOfWork either (i.e. gap
  detection is genuinely per-binding-type-presence, not "card exists therefore assume all 3 gaps").
  `SObjectBindingCard`/`ServiceBindingsSection` component tests for each row state table above.
- **Stage 2** (landed): `bindingDrawerCopy.test.ts` — every type's header/breadcrumb/RESULTING BINDING
  wording and priority-competition clause (wins/ties/shadowed), and the CLI-preview string, asserted
  against the flattened segment text. `App.test.ts`/`BindingForm.test.ts` extended to assert the new
  breadcrumb/type-pill/CLI-preview markup renders and that dashed-vs-solid tracks create-vs-edit. No test
  asserts an `isActive`/delete affordance, since none is ever rendered for an Application Factory type
  (nothing to assert the *absence* of beyond the existing "no such element" component tests already
  covering the form's full field set).
- **Stage 3** (landed): `dragReorder.test.ts` — ordering, midpoint assignment (touches only the moved
  card when neighbors have room), the full-renumber fallback when they don't, revert, and the
  round-trip-reports-no-change case. `SObjectBindingsSheet.test.ts` — Move Up/Down only renders for a
  card with a real Unit of Work binding and is disabled at the boundaries, staging/reverting/saving a
  move, the sequence-collision banner, and both the successful and partial-failure `lastBatchResult`
  banners. No dedicated host-side test for `submitSequenceBatch` itself, matching this codebase's
  existing convention of not unit-testing `at4dxExplorerPanel.ts`'s other write handlers
  (`submitBinding`/`submitApplicationFactoryBinding` have none either) — covered by the Manual pass below.
- **Stage 4** (landed): `fieldSetInclusionView.test.ts` — active-only filtering, per-SObject counting, the
  `no field sets`/`1 field set`/`N field sets` wording, and developer-name suggestion (sanitization,
  collision suffixing, the 40-character cap). `applicationFactoryCli.test.ts` extended with
  `getFieldSetInclusions`/`createSelectorFieldSetInclusion`/`updateSelectorFieldSetInclusion` coverage
  mirroring the existing binding tests (local/org scans, the org-`missing`-flag path, blocked vs. thrown
  writes). `App.test.ts` extended: the section renders only for the Selector segment, Add/Remove post the
  right payloads, and — the one behavior genuinely new to this stage —
  `fieldSetInclusionsUpdated`/`fieldSetInclusionBlocked`/`fieldSetInclusionError` all update the
  still-open drawer **without** it closing, unlike every other write in this panel. No dedicated
  host-side test for `submitFieldSetInclusion`, same convention as Stage 3's `submitSequenceBatch`.
- **Manual** (F5), each stage: confirm the tab strip / card sheet / drawer / drag / inclusions against
  `testfixtures/`, plus one connected-org pass per stage before it's marked `Implemented`.

## Open questions

- *(Resolved)* **5a's "declared but unbound interface" / "bound to a class that no longer exists"
  rows** — the library has no way to enumerate a declared-but-unbound interface, confirmed once Stage 1
  actually shipped. Those two sections were left out of the Service Bindings tab; a future doc can revisit
  if the library grows the necessary read (e.g. from interface metadata scanning).
- **Rename** (deviation 6) — deliberately left locked here; revisit once/if the library grows an atomic
  rename. Not blocking.
- **Domain Process band-drag** (4a) — deferred, not designed; its own "failure state needs its own
  design" note stays unresolved until someone picks it up as a dedicated follow-on doc.
- *(Resolved)* **Whether Stage 1 ships all four grid states in one PR or splits further** — it shipped
  as one PR ([#40](https://github.com/SimplySF/simply-vscode/pull/40)), keeping every card-row state from
  the doc's own table intact.
- **No Delete affordance, anywhere, for any binding type or field set inclusion** (deviations 2, and the
  Stage 4 "no delete" note) — remains open until `simply-aep-core` grows a delete function. Not blocking;
  every "remove" in this panel is deactivation, which the doc treats as the honest option given what the
  library actually supports today.
