# 0012 — Prevent Recursive & Logical Inverse Row Indicators

**Status:** Superseded by [0013](0013-at4dx-bindings-panel-redesign.md) (icons replaced by labelled text columns; implemented via PR [#23](https://github.com/SimplySF/simply-vscode/pull/23))
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-28

## Problem

A binding row today shows a Criteria/Action icon, an async marker (only when `executeAsynchronous` is
true), the developer name, order, any validation badges, and an Active/Inactive pill. Two fields the
create/edit form already exposes — `PreventRecursive__c` and `LogicalInverse__c` — have no row-level
indicator at all: seeing whether a binding guards against recursive re-entry, or inverts its criteria's
result, means opening the edit form for that one row. For a section with several bindings, comparing
which ones prevent recursion or invert their logic means opening each one in turn.

## Decision

Add two more indicator icons to `BindingRow.svelte`'s icon group, next to the existing async marker.
Unlike the async marker (hidden when `executeAsynchronous` is false, so a row with nothing unusual
going on stays visually quiet), both new indicators render in **both** states — on and off — so a whole
section can be scanned at a glance for which bindings prevent recursion or invert their logic, not just
which ones do. The "on" state renders at full `--vscode-descriptionForeground` opacity; the "off" state
renders the same glyph at reduced opacity, so the on rows still pop without hiding the off ones.

Three new named variants on the existing `Icon.svelte` component (matching its one-name-one-glyph
convention, not a shared name plus a state prop — see Alternatives considered). Recursion gets a
distinct glyph per state; logical inverse reuses one glyph for both (see below the table for why):

| Row field | Icon name | Tooltip |
| --- | --- | --- |
| `preventRecursive: true` | `recursion-prevented` | "Recursion prevented" |
| `preventRecursive: false` | `recursion-allowed` | "Recursion allowed" |
| `logicalInverse` (either state) | `logical-inverse` | "Logical inverse enabled" / "…disabled" |

`recursion-prevented`/`recursion-allowed` share the same base glyph — an infinity symbol (∞), reading
directly as "can recur indefinitely" — with a diagonal strike-through added only for the prevented
state, the same "same shape, struck through when blocked" convention as a muted-microphone or no-repeat
icon. `logical-inverse` is a single crescent-moon glyph (a supplied asset — a full circle with a
smaller offset circle cut out of it via `fill-rule: evenodd`, not hand-derived) used unchanged for both
states; unlike the recursion pair, on/off is carried entirely by the row's existing dimmed-when-off
styling (see Behavior) rather than a second glyph variant, since the source asset is a single fixed
silhouette with no natural "outline-only" counterpart to derive one from without inventing a shape the
asset doesn't define. Tooltip wording deliberately mirrors the field's own name (`Prevent Recursive`,
per the create/edit form — see 0009) rather than an inverted "recursion enabled" phrasing, so there's
one sense to remember across the panel and the form, not two.

## Behavior

### Row layout

```
[type icon] [async icon?] [recursion icon] [inverse icon]   DeveloperName   Order: N   [badges…]   [Active/Inactive]   [edit]
```

Both new icons are their own `.flag-icon` spans, siblings of `.row-icon` (not nested inside it), placed
right after it and before the developer name — same 14×14 sizing convention as `.async-icon`, just
always present instead of conditional. Each carries a `title` tooltip (per the table above) the same way
the async icon already does. The logical-inverse icon is sized up slightly (18×18, via a `.flag-icon-moon`
modifier) — the supplied crescent asset reads noticeably smaller than the hand-drawn glyphs at 14px, so
it needs the extra size to stay legible at the same visual weight as its neighbors.

### Visual states

| State | Opacity | Color |
| --- | --- | --- |
| On (`preventRecursive`/`logicalInverse` true) | 1 | `--vscode-descriptionForeground` |
| Off (false) | 0.4 | `--vscode-descriptionForeground` |

No color-coding by severity (not an error/warning condition) — these are informational, matching the
async marker's own neutral styling, not the badge/pill red-green vocabulary used elsewhere in the row.

## Alternatives considered

**A shape-toggling glyph per flag whose state is driven by a boolean prop**, instead of separate named
variants for recursion's two states. Rejected: `Icon.svelte`'s existing contract is one `name` → one
fixed glyph, used identically by every other icon in the row; adding a second, icon-specific `active`
prop only to recursion would be a special case future readers have to notice and remember, for no real
savings — the extra variant is one more `{#if}` branch inside `Icon.svelte`, not meaningfully more code
than a prop-driven version. `logical-inverse` ends up single-glyph anyway (see Decision), but *because*
its source asset has no natural second state to branch to, not because a prop would have been better —
had it needed one, the same objection would apply.

**Only show an icon when the flag is true**, matching the existing async marker exactly. Rejected per
the request driving this doc: the value here is specifically in seeing the *off* state too, to compare
bindings within a section at a glance — "prevents recursion" is exactly the kind of thing worth knowing
is *not* set, the same way seeing "Inactive" spelled out (rather than just omitting the pill) already
matters more than seeing "Active" does.

**Badge-style chips (like the validation badges) instead of icons.** Rejected: two more always-present
chips per row would compete visually with the validation badges, which mean something more urgent
(actual wiring problems) — icons in the existing icon group keep this at the same visual weight as the
Criteria/Action/async markers it's informational alongside, not promoted to "this needs attention."

**A single combined "flags" icon that opens a tooltip listing every boolean field**, instead of one
icon per flag. Rejected: loses the at-a-glance scan this doc is for — a reader would have to hover every
row to learn anything, which is exactly the "open each one in turn" friction being removed.

## Implementation plan

1. **`src/webview/Icon.svelte`** — add `recursion-prevented`, `recursion-allowed`, `logical-inverse` to
   the `IconName` union and their `{#if}` branches.
2. **`src/webview/BindingRow.svelte`** — inside `.row-icon`, after the existing async-marker `{#if}`,
   add the two new indicators, each a `<span class="flag-icon" class:flag-off={...}>` wrapping the
   appropriate `Icon`, with `title` set per the Behavior table.
3. **`src/webview/App.svelte`** (or wherever `SHARED_STYLE`'s port lives) — add `.flag-icon` (14×14,
   `--vscode-descriptionForeground`, matching `.async-icon`) and `.flag-icon.flag-off` (opacity 0.4).
4. **`test/webview/BindingRow.test.ts`** — new cases: both flags true renders both indicators at full
   opacity with the correct "on" tooltip text; both false renders both dimmed (`flag-off`) with the
   correct "off" tooltip text; a mixed case (one true, one false) renders the right pairing per field,
   not just "any flag true → both show as on."
5. **`README.md`** — extend the Usage section's row description to mention the two new indicators and
   their tooltips.

## Testing

**Automated:** `npm run compile` (esbuild + `tsc --noEmit` + `svelte-check`) and the new
`BindingRow.test.ts` cases above (`@testing-library/svelte`, asserting the rendered icon name via a
`title`/class query and the dimmed state's class).

**Manual:** in a real Extension Development Host, a section with at least one binding in each of the
four flag combinations (both off, both on, each individually on) — confirm the right icon/tooltip pair
renders per row and the dimmed "off" styling reads clearly against both a light and a dark VS Code theme.
Run by the user; passed — the infinity/crescent-moon pair, the strike-through vs. dimmed-opacity
distinction, and the 18px moon-icon bump (added after an initial pass found the crescent read too small
next to the recursion glyph) all confirmed legible across the flag combinations.

## Open questions

- **Whether these two indicators eventually deserve a validation-style badge instead of an icon**, if a
  future rule (e.g. "recursion prevention likely needed here") gets added to `simply-aep-core`'s
  validator — not designed here; today these are purely informational, not something the panel validates.
