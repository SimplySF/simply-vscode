# 0013 — AT4DX Bindings Panel List & Form Redesign

**Status:** Implemented (PR [#24](https://github.com/SimplySF/simply-vscode/pull/24))
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-28

## Problem

Three things are wrong with the bindings panel as shipped.

**The `+ New Binding` button never goes away.** `App.svelte` gates `SummaryBar` on
`view === 'list'` but renders `<Toolbar>` unconditionally, so the toolbar — SObject select, Trigger
Event select, and an enabled `+ New Binding` — stays on screen while the user is filling in the
create form and while they are editing an existing row. The screen has two competing primary
actions, and clicking `+ New Binding` from inside a half-filled edit form silently discards it via
`openCreateForm()`. Users read the button as "the form isn't really open."

**A binding row is a sentence, not a record.** `BindingRow.svelte` lays out one flex line: async
icon, type icon, recursion icon, logical-inverse icon, developer name, `Order: N`, badges, status
pill, edit icon. Nothing aligns vertically between rows, so comparing two bindings means reading
both left to right. The three flag icons added in 0012 are legible only by tooltip. Meanwhile the
developer name — the widest element in the row — is largely redundant with the class it injects,
since the convention is to name the binding after it.

**The create/edit form is an undifferentiated 12-field grid.** Identity, trigger context, and
behavior are interleaved in source order, `SObject` sits next to an unlabelled alternate-field
checkbox, and nothing tells the user what the binding they are describing will actually do until
they save it.

## Decision

Redesign the panel's list rows as a real column grid, regroup the form into three labelled sections
with a live preview of the resulting binding, and make the toolbar mutually exclusive with the form
view so `+ New Binding` exists only when browsing. All styling continues to come from
`var(--vscode-*)` tokens and lives in `App.svelte`'s `:global` block; no new host messages, no
changes to `types.ts`, no changes to `save()`'s validation.

## Behavior

### List view

Each section card gains a column header row, and each binding renders as a fixed-height grid row:

| Order | Type | Class to Inject | Async | Recursion | Logical Inverse | Status | |
|-------|------|-----------------|-------|-----------|-----------------|--------|-|
| `10.1` | `Criteria` | `FishSlogansCriteria.cls` | — | Enabled | Yes | ● Active | ✎ |
| `10.2` | `Action` | `FishSlogansAction.cls` | ◷ Yes | — | — | ● Active | ✎ |
| `20.1` | `Action` | `FishSlogansNotify.cls` | — | Enabled | — | ○ Inactive | ✎ |

- `developerName` is no longer rendered in the list. `classToInject` becomes the row's visible
  identifier and carries the link color; the row click still posts `openClass`.
- `Type` is an outlined pill (uppercased by CSS, not markup) — blue for Criteria, yellow for
  Action — replacing the type icon.
- `executeAsynchronous` gets its own labelled Async column — a small clock icon plus `Yes` when true,
  a dim em-dash when false — rather than folding into the Type pill (a `· async` suffix would make the
  pill's width vary by row).
- `preventRecursive` and `logicalInverse` become labelled text columns (`Enabled` / `Yes` vs a dim
  em-dash) replacing 0012's icons. 0012 is marked superseded by this doc.
- `Status` becomes a colored dot plus label, replacing the `.pill`.
- Row height is fixed at 40px (via `height`, not `min-height`) so columns always align. Issue badges
  get their own auto-width column between Logical Inverse and Status — a 9-column grid, not 8 —
  rather than sharing the Status cell; a badge is roughly 200px wide and wrapping it into the fixed
  78px Status track would grow that row past 40px and break alignment for every row below it. The
  badge column collapses to zero width on badge-free rows.
- The type pill hugs its label (`justify-self: start`) rather than stretching to the grid track, so
  `Action` and `Criteria` stay visually distinct by width. Action's pill uses
  `--vscode-charts-yellow`, Criteria `--vscode-charts-blue`.
- Below 700px, the Recursion and Logical Inverse columns are dropped (`display: none` via a
  `:nth-child` media-query rule) rather than shrunk. The row's `title` attribute carries the
  developer name (the field the redesign removed from the visible list), not the hidden columns —
  those get their own per-cell tooltips instead, so they stay discoverable. The Async column stays
  visible at every width.
- Above the table, the pre-redesign heading card (crown icon, `a(n)` placeholder grammar) is replaced
  by a single-line context strip: `When an Account record is Created, 6 bindings are evaluated in
  order.` `SummaryBar` above the toolbar already covers issue counts (scan-wide, not per-SObject), so
  the strip doesn't duplicate that state.

### Create view

The toolbar is not rendered. In its place, a context bar carries the breadcrumb
`Account / Created › New binding` and the form's two actions, `Cancel` and `Create binding`. Below
it, the locked scope is shown as two read-only pills, then a live sentence:

> When an **Account** is **Created**, run the **Action** `AssignOwner.cls` at order `10.3` during
> **Trigger Execution**.

recomputed from form state on every change. Fields are then grouped into three numbered cards:

| Section | Fields |
|---------|--------|
| 1 Identity | Developer Name*, Label |
| 2 When it runs | SObject*, Process Context, Trigger Operation* / Domain Method Token*, Order*, Use Alternate SObject Binding |
| 3 What it does | Type, Class to Inject*, and the flags Active / Execute asynchronously / Logical inverse / Prevent recursive |

Description remains a full-width textarea below the cards. Required fields are marked with an
asterisk. `Bind via alternate field` becomes a labelled toggle reading **Use Alternate SObject
Binding** with its Setup-object note as helper text — still a real `<input type="checkbox">`
underneath, just restyled, so keyboard and screen-reader behavior are unchanged. `Type` becomes a
two-segment control (Action / Criteria) instead of a `<select>`. Validation rules, messages,
`writeBlocked` / `writeError` handling, and the `Save Anyway` force path are unchanged.

### Edit view

Same context-bar pattern: `Editing <developerName>`, `Discard`, and `Save changes`. The rest of the
form is identical to create — same three sections, same fields — with Developer Name disabled
rather than hidden, matching the panel's existing behavior. See "Alternatives considered" for why
this ships instead of the inline-in-list edit the original handoff explored.

### Invariant

There is no state in which the toolbar's `+ New Binding` and a form are both on screen. The
placeholder toolbar rendered for the `loading` / `error` / `empty` states is likewise suppressed on
the form view.

## Alternatives considered

**Disable `+ New Binding` on the form view instead of hiding it.** Keeps the toolbar's layout stable
and avoids the panel shifting when the form opens. Rejected: a disabled control with no explanation
is the weaker signal, and the SObject / Trigger Event selects beside it would also need disabling —
at which point the whole bar is inert chrome above a form that already states its own scope. Hiding
it and restating the scope as pills says the same thing with less.

**Keep the developer name column and drop Class to Inject.** Rejected: the class is what the user
navigates to (the row click already opens it) and what the two flag columns qualify. The developer
name is conventionally derived from the class, so showing both spends the widest column on a
near-duplicate. It remains visible in the edit context bar and in issue entries.

**Keep 0012's flag icons in the new columns.** Genuinely close, and still available — the grid does
not care. Text was chosen because a column with a header saying `Recursion` and a cell saying
`Enabled` needs no tooltip, and the moon glyph for logical inverse was not self-evident.

**A modal dialog for create/edit.** Rejected: VS Code webview panels do not own a modal layer, and
0009 already settled on in-panel views. A dialog would also have re-created the same
two-primary-actions problem behind a scrim.

**Inline-in-list editing (the row expands in place, siblings dim).** This was the original handoff's
centerpiece for the edit view — the edited row stays visible among its neighbors, with only the
editable subset of fields (Label, Class to Inject, Trigger Operation, Order, three flags) shown
inline. It's genuinely more useful for reordering, since you can see the row's neighbors while you
change its order. Deferred: it requires `BindingSections`/`BindingRow` to track which row is open and
render two different layouts for the same data, which is real churn for a first pass whose actual bug
report is the toolbar staying visible. Shipping the full-page form (same as create, all fields, just
with Developer Name disabled) for edit too gets every other part of this doc — columns, context bar,
sections, preview, toggle, segmented control, the toolbar fix itself — without that risk. Worth
revisiting as a follow-up if reordering from the edit form proves awkward in practice.

## Implementation notes

Shipped as one change rather than the two-PR split the handoff sketched, since the list-column and
form-section work touch the same files enough that splitting them added review overhead without
reducing risk — the toolbar-gating fix (the actual reported bug) is a two-line change independent of
either.

Resolutions to the open questions below were made during implementation, not left for a follow-up:

1. **0012 is superseded by this doc** — the two flag columns render as text (`Enabled`/`Yes` vs `—`),
   not 0012's icons.
2. **Domain is not a third Type.** The segmented control has two segments, Action and Criteria,
   matching `DomainProcessType`.
3. **The "Implements TriggerAction — found in workspace" hint was omitted.** It needs workspace class
   resolution that doesn't exist yet; worth its own doc if wanted.
4. **Edit uses the full-page form, not inline-in-list editing** — see "Alternatives considered" above.
5. **Narrow-panel behavior:** Recursion and Logical Inverse columns are dropped below 700px; their
   values remain available via per-cell tooltips. Async stays visible at every width.
6. **`executeAsynchronous`** has its own labelled Async column (clock icon + `Yes`/`—`), not a suffix
   on the Type pill — see "Behavior" above.

A first implementation pass shipped the column grid but missed the heading (still the pre-redesign
crown card) and put issue badges inside the fixed-width Status cell, which overflows or wraps to a
second line and breaks row alignment the first time a workspace has a wiring problem — invisible on
a clean fixture, so it needs its own test (see "Testing"). A follow-up review pass (`REVIEW-01.md`,
2026-08-28) caught both, plus the type pill stretching to its grid track, the Action pill's color, and
a redundant row tooltip that duplicated visible columns instead of restoring the developer name. All
five are folded into "Behavior" above rather than left as a separate errata list.

One thing not in the original handoff: the "next free order" hint for the Order field (mentioned as
optional/deferred there) was not built — it would need the current section's rows threaded into
`BindingForm`, which isn't worth it for a hint.

## Testing

**Automated** (`vitest`, per 0010):
- `App.test.ts` — the toolbar invariant: present in the list view for `kind: 'data'`; absent after
  `openCreateForm()`; absent after `openEditForm(row)`; disabled placeholder present for `loading`.
- `BindingRow.test.ts` — each column renders from its row field; `developerName` is not in the row's
  text (but is the row's `title`); `classToInject` is; the Async column shows `Yes` with the clock
  icon when `executeAsynchronous` is true (and the Type pill carries no suffix); inactive rows carry
  `.inactive`; `openClass` still posts on row click and `onEdit` still fires on the edit icon with
  propagation stopped; an issue badge renders in its own cell, a sibling of the status indicator, not
  inside it; Recursion/Logical Inverse cells carry their own tooltips.
- `App.test.ts` — the header renders as a crown-free context strip containing the binding count; the
  header sentence uses `an`/`a` correctly for a vowel- vs. consonant-initial SObject.
- `BindingForm.test.ts` — every field still reachable after regrouping; the alternate-binding toggle
  is still an `input[type=checkbox]` bound to `sobjectAlternate`; the segmented Type control emits
  `Action` / `Criteria` and offers no third option; all existing validation cases unchanged; the
  preview sentence updates as `classToInject`/`order`/`triggerOperation` change; the breadcrumb calls
  `onCancel`.
- Compile: `tsc --noEmit` and `svelte-check` via the existing build — both clean.

**Manual** (F5, Extension Development Host):
- Open the panel on `testfixtures/`, confirm columns align across sections and inactive rows dim.
- Click `+ New Binding`; confirm the toolbar is gone and only `Cancel` / `Create binding` remain.
  Press Cancel; confirm the toolbar returns with the prior SObject and Trigger Event selection
  intact.
- Open the edit form from a row; confirm no `+ New Binding` and that Developer Name is not editable.
- Trigger a `writeBlocked` (a binding that introduces a wiring problem) and confirm the issue block
  and `Save Anyway` still render inside the new layout.
- Switch between a light theme, Dark+, and a high-contrast theme; confirm no hardcoded color
  survives — particularly the type pills, status dots, and toggle.
- Narrow the editor tab to roughly half width and confirm the Recursion/Logical Inverse columns drop
  out cleanly.

## Open questions

1. Is inline-in-list editing worth building as a follow-up once someone hits the "can't see neighbors
   while reordering" friction in practice?
2. Validating that Class to Inject implements `TriggerAction` would make the form far more useful,
   but needs workspace class resolution and belongs in its own doc.
