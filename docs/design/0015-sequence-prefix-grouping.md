# 0015 — Sequence-prefix grouping in the bindings list

**Status:** Draft
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-28

## Problem

Within one trigger phase (`Record Before Save`, etc.) the panel renders a flat, order-sorted list of
bindings. But AT4DX orders are not flat: the convention in every codebase we have looked at is that
the integer part of `Execution_Order__c` identifies a *unit of work* and the fractional part orders
the bindings inside it. `10.1` is a criteria class; `10.2` and `10.3` are the actions that criteria
gates. `20.1`/`20.2` are a different unit entirely.

A flat list hides that. Reading it, you cannot see where one unit ends and the next begins without
mentally parsing every order number, and the most common wiring question — *"which actions does this
criteria control?"* — has no visual answer. It also makes the panel's own validation rules
(`criteria without a matching action`) look arbitrary, because the grouping those rules operate on
is not drawn anywhere.

## Decision

Group each section's rows by the integer part of `order` and render each group as a **collapsible
band**: a caption row stating the prefix, what the group is composed of, and its order range,
followed by the group's rows.

This is option `4b` in the prototype (`AT4DX Bindings Redesign.dc.html`, turn 4). The alternative
`4a` — a spanning left-hand prefix rail with the suffix (`.1`, `.2`) in the order column — was
rejected: it is more compact, but it hides the full order value, which is the field users type into
the form and read in metadata, and it cannot carry a per-group summary or a collapse affordance.

### Grouping rule

- Prefix = `Math.trunc(row.order)`. Groups sorted ascending by prefix; rows inside a group sorted
  ascending by `order`, as today.
- Rows with no usable order (`null`, `undefined`, `NaN`) collect into a final group with prefix
  `null`, captioned `No order`. They are not silently dropped and not merged into group `0`.
- **A section with only one group renders no band at all** — rows go directly under the column
  header, exactly as they do today. A band drawn around 100% of the rows adds a level of chrome that
  discriminates nothing. Bands appear when there is a boundary to show.

### Caption

`10 · 1 criteria gates 2 actions · 10.1 – 10.3`

Composed from the types actually present in the group:

| Group composition | Caption phrase |
|---|---|
| criteria + actions | `N criteria gate(s) M action(s)` |
| actions only | `M action(s)` |
| criteria only | `N criteria` (flag: this is what the `criteria without a matching action` rule fires on) |

The range reads `10.1 – 10.3` for multi-row groups and just `10.1` for a single-row group. No
human-readable group *name* is rendered — the prototype's "Fish slogans" was illustrative; there is
no field to derive it from, and inferring one from a common developer-name prefix would be a guess
shown as fact.

### Collapse

Bands are expanded by default and collapse on click of the caption row (chevron `▾`/`▸`). State is
per section-and-prefix, held in the webview only — it does not survive a reload, and it is not
persisted to the host. Collapsing is for reading a long list, not a saved preference.

**A collapsed band must never hide a problem.** If any row inside a collapsed group carries an issue
badge, the caption row shows a `⚠ N` marker in the badge's severity color. Expanding reveals the
badges themselves.

## Non-goals

- No change to sorting, filtering, or the row grid's columns.
- No drag-to-reorder, no "insert into this group" affordance on the caption row. Creating a binding
  still goes through the toolbar; the form's "next free order" hint already does the useful part.
- No grouping in the Domain Method Execution view, where sections are already keyed by token and
  orders are not a sequence convention. `buildSections` returns one section per token; grouping
  applies inside a section, so it will still run — with one group per section in practice, which the
  single-group rule renders as today's flat list. Nothing to special-case.

## Open questions

- Should a group whose criteria is inactive dim its actions, given they will not run? Correct
  reading of AT4DX semantics, but it would be the first place the panel infers runtime behavior from
  more than one record. Proposed: no, not in this change.
- Does the `criteria without a matching action` rule want to fire *per group* rather than per
  section? If the intended unit of work is the prefix group, the current rule may be measuring the
  wrong thing. Out of scope here, but this design makes the discrepancy visible.
