# 0003 — AT4DX In-Panel Selection & Loading State

**Status:** Implemented (PR #7)
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-25

## Problem

Today, feedback while `sf` is scanning for bindings is a small notification toast ("Reading AT4DX
Domain Process Bindings…") in the bottom-right corner — easy to miss, and disconnected from where the
result actually lands (the webview panel, which doesn't open until after the SObject and trigger-event
QuickPicks, once rows are already in hand). That gap is exactly what made the hang investigated
earlier in this repo's history hard to notice at a glance: the only sign anything was happening was
that small toast, sitting there indefinitely with nothing else on screen to anchor it to.

Separately, once the scan *does* finish, getting to a different SObject or trigger event means
re-invoking two more native QuickPicks — each a small round trip away from the panel that's actually
showing the result, even though every row needed to answer both questions is already sitting in
memory.

## Decision

Open the `DomainProcessBindingPanel` immediately once Local Source or a connected org is picked. The
panel owns SObject and operation-family selection itself, as two dropdowns in its own toolbar, rather
than native VS Code QuickPicks — the SObject/trigger-event QuickPick steps go away entirely. Both
dropdowns start disabled with a single "Loading…" placeholder while `sf` runs; that disabled state
*is* the loading indicator, no separate spinner needed. Once bindings are fetched, every row is
embedded into the webview as data, the dropdowns populate and enable, and picking either one re-renders
the content entirely client-side — no round trip back to the extension host, since nothing about
"show a different slice of data already in hand" needs the extension host's involvement.

The panel becomes the single home for every outcome of a run: a scan error or "no bindings found"
also renders inside it, dropdowns left disabled, instead of a separate notification/info toast.

## Behavior

### Sequencing

```
pick workspace folder
pick binding source (Local Source | Connected Org…)
  [pick specific org, if Connected Org]
→ panel opens/reveals: SObject + Operation dropdowns both disabled ("Loading…"), empty content area
→ sf runs (getDomainProcessBindings)
  ├─ error         → content area shows the error message (same text at4dxCli.ts already produces);
  │                   dropdowns stay disabled
  ├─ zero bindings  → content area shows "No AT4DX Trigger Action Framework bindings found";
  │                   dropdowns stay disabled
  └─ bindings found → SObject dropdown populates (alphabetical) and enables, defaulting to the
                       first entry; Operation dropdown scopes to families that SObject actually has
                       bindings for and enables, defaulting to the first available; content area
                       renders that selection immediately
       ↳ changing SObject → Operation dropdown rescopes to the new SObject's families, content
                             re-renders — all client-side, no re-fetch
       ↳ changing Operation (same SObject) → content re-renders for that family — client-side
```

- `pickSObject` and `pickOperationFamily` (today's native QuickPicks in `extension.ts`) are removed.
  `showDomainProcessBindings` becomes: pick workspace folder → pick binding source → open the panel
  in its loading state → fetch → hand the panel every row (or the error/empty outcome).
- Row-click-to-open-class is unchanged in effect (still needs the extension host to search the
  workspace and open a document) — its `postMessage` listener just has to be re-attached after each
  client-side re-render, since the `.row` elements get replaced.
- Re-running the command while a panel is already open reveals that same panel (existing singleton
  behavior via `currentPanel`) and re-runs the full scan, resetting both dropdowns to their loading
  state and then their fetched defaults — it does not try to preserve whatever was selected before.

## Alternatives considered

**Keep the existing notification toast, and/or a separate full-panel spinner state, instead of folding
selection into the panel too.** This was this doc's original shape (see git history on this file) —
superseded once the follow-up ask was to also move SObject/operation selection into the panel, since a
disabled dropdown *is* a loading indicator and needs no separate spinner screen alongside it.

**A persistent status bar item instead of the panel.** Still disconnected from where the result lands,
and adds a UI surface that has to stay in sync with the panel for no real benefit — rejected for the
same reason as in this doc's first draft.

**Filtering via a `postMessage` round trip to the extension host on every dropdown change**, instead
of embedding all rows and filtering client-side. Rejected: a round trip only earns its keep when the
extension host needs to do something only it can do (file access, re-running `sf`) — neither applies
to "show a different already-fetched slice of the same data," which the webview can do instantly on
its own.

**A single dropdown combining SObject and operation family** (e.g. "Account — Created"). Rejected:
doesn't scale for an SObject with bindings across several trigger operations — the combined list gets
long fast, and two dropdowns let someone re-check a different family for the same SObject without
re-finding it in a merged list.

**Moving SObject/operation selection into the panel but keeping the pre-scan panel-open moment gated
behind the existing notification toast** (i.e., only open the panel once data is ready). Rejected:
defeats the actual point — opening the panel immediately, before the scan even starts, is what gives
the loading state somewhere prominent to live.

## Implementation plan

1. `src/domainProcessBindingPanel.ts` — substantial rewrite:
   - `DomainProcessBindingPanel.open()` replaces `show(sobject, family, rows)`: creates/reveals the
     panel in its loading shell (both dropdowns disabled, single "Loading…" option, empty content
     area), no rows required yet.
   - `panel.setRows(rows: DomainProcessBindingRow[])` embeds `rows` as JSON into the page and enables
     the dropdowns; `panel.showError(message)` and `panel.showEmpty()` cover the other two outcomes.
   - SObject-list derivation and per-SObject family-availability (today's `availableFamilies` logic,
     currently in `extension.ts`) move into the webview's inline client-side script, since that's now
     where the filtering happens.
   - The row/section rendering logic (`rowHtml`/`sectionHtml`/`buildSections` today) gets ported to a
     client-side template function running in the webview's `<script>`, driven by the embedded data
     and the two `<select>` elements' current values — string-building JS, matching this file's
     existing style, no framework.
   - Dropdown `change` listeners re-render the content area and re-attach the row-click
     `postMessage` handlers (existing CSP/nonce setup is unaffected — everything stays first-party
     inline script under the same `script-src 'nonce-…'` policy).
2. `src/extension.ts`:
   - Remove `pickSObject`, `pickOperationFamily`, `FAMILY_ITEMS`, and `availableFamilies`.
   - `showDomainProcessBindings` becomes: pick workspace folder → pick binding source →
     `DomainProcessBindingPanel.open()` → fetch rows, calling `showError`/`showEmpty`/`setRows` on
     the panel depending on outcome, dropping the corresponding `showErrorMessage`/
     `showInformationMessage` calls (the panel is now the single surface for all three outcomes).
3. No changes to `at4dxCli.ts` or `package.json`.
4. `README.md` — update the extension's own behavior/usage description from "QuickPick chain" to
   "in-panel dropdowns," per this repo's convention that the design doc records reasoning while the
   README records the actual user-facing behavior.

## Testing

Manual only (no automated extension test harness yet — same gap flagged in 0001 and unaddressed since):

- Happy path end to end: dropdowns disabled during the scan, enabled and populated with sensible
  defaults once it completes.
- Switch the SObject dropdown: Operation dropdown rescopes to that SObject's actual families, content
  re-renders correctly, no round trip/flicker.
- Switch the Operation dropdown alone (same SObject): content re-renders for that family.
- `sf` error and zero-bindings cases: correct panel state shown, dropdowns stay disabled.
- Row click still opens the right Apex class file *after* at least one dropdown-driven re-render —
  the case most likely to regress if the click handler isn't re-attached correctly.
- Re-run the command with the panel already open: confirm it resets to the loading state and refetches
  rather than silently reusing stale data.

## Open questions

- **No "Try Again" affordance in the error state for v1.** Flagged, not designed here.
- **Dropdown selections don't persist across a full re-run** (re-running the command while looking at
  "Account / Updated" doesn't try to reselect that pair once new data loads) — acceptable for v1,
  worth revisiting if it turns out to be annoying in practice.
- **Client-side rendering stays plain string-building JS**, matching the extension host's existing
  style — noted so nobody's surprised the webview script stays dependency-free rather than pulling in
  a templating library for what's a fairly small amount of markup.
