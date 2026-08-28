# 0014 — AT4DX Explorer Tab Strip

**Status:** Implemented (PR [#27](https://github.com/SimplySF/simply-vscode/pull/27))
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-28

## Problem

`simply-at4dx` contributes exactly one thing: the `AT4DX: Show Domain Process Bindings` command. That
was right when the extension did one thing, but the plan is for it to host several sibling explorers —
Application Factory Bindings and Platform Event Distributor to start — and the current shape has
nowhere to put them.

Concretely, three problems today:

**There is no way to discover what the extension does.** The only entry point is a command palette
string. A user who installs it and doesn't already know the command name finds nothing.

**Adding a second explorer would mean a second unrelated command** with no relationship to the first,
and a third and fourth after that — a flat list of palette entries that never adds up to a product.
Nothing tells the user these are facets of one framework.

**The panel's identity is implicit.** The webview tab and the extension are effectively the same thing
right now, so "which explorer am I looking at" has never had to be answered. With more than one, it
does.

## Decision

Add a tab strip to the top of the existing webview panel, inside `App.svelte`, listing all three
explorers. Only Domain Process Bindings is wired up — its tab is the only clickable one and carries a
live binding-count badge; Application Factory Bindings and Platform Event Distributor render as
visibly inert `Coming soon` tabs, so the structure is legible and adding them later is additive.
Everything below the strip — toolbar, header sentence, section grid, issues — is unchanged from 0013.

This is option `3b` from the design canvas, not `3c` (Activity Bar container + sidebar
`TreeDataProvider` + one editor tab per explorer, specced in the now-superseded
`HANDOFF-02-explorer-shell.md`). No `package.json` contributions, no new activation event, no
`TreeDataProvider`, no new asset — the entire change lives in the webview plus the small amount of
host code that already feeds it its initial state.

## Behavior

### Tab strip

A new bar sits directly above the toolbar (and above the loading/error/empty placeholder toolbar too —
it renders in every panel state, not just the data view):

| Tab | State | Content |
|-----|-------|---------|
| Domain Process Bindings | Live, active | Icon, label, and — once a scan has produced data — a badge showing the binding count for the currently selected SObject + Trigger Event, the same number the header sentence already states. |
| Application Factory | Inert | Icon (dimmed), label (dimmed), `Coming soon`. No click handler, no data — nothing to be inert *about* exists yet. |
| Platform Events | Inert | Same treatment as Application Factory. |

Only Domain Process Bindings is interactive; there is nothing to switch *to* until a second explorer
exists, so the strip does not yet implement tab-switching logic — it is an identity bar today, and
becomes an actual switcher only once there's a second real explorer to switch to (see Open Questions).

To the right of the tabs, a short source label shows what the current scan read from — an org username,
or a workspace-relative path for a local/chosen-folder scan — truncating with an ellipsis (full value in
its `title`) rather than wrapping the strip.

### Editor tab

The panel title changes from `AT4DX Bindings` to `AT4DX Explorer`, since the tab strip now makes clear
the panel isn't only about bindings. Still one webview, one editor tab, unchanged command
(`simply-at4dx.showDomainProcessBindings`) and unchanged two-QuickPick flow to open it.

### Command palette

Unchanged. The tab strip is discoverability chrome inside the panel, not a new entry point — that's
what distinguishes this from `3c`, where the sidebar tree was itself an additional launcher.

## Alternatives considered

**The native Activity Bar container + sidebar `TreeDataProvider` (`3c`).** Maximum discoverability —
an Activity Bar icon, a tree that's a launcher independent of any open tab, side-by-side explorer tabs
via native editor-tab splitting. Speccced in full in `HANDOFF-02-explorer-shell.md`, including a review
pass that found and fixed five real issues (a rescan bug that discarded valid cached scans, a testing
plan that unknowingly asked for coverage `docs/design/0010` deliberately excludes, an unbuilt
`test/support/vscodeStub.ts` gap, a dead command argument, and a stale cross-reference to a header
element that no longer exists). Even after those fixes, `3c` needs a new SVG asset nobody has supplied
yet, `package.json` contributions, a hand-written `TreeDataProvider` with its own cache and icon-tinting
logic, and a test harness extension with no existing pattern to copy in this repo. That's a real chunk
of new, permanent surface to build and maintain for two explorers that don't exist yet. `3b` gets the
same "these are facets of one framework" message across for one Svelte component and zero new host
surface. Worth revisiting once a second explorer is real, side-by-side viewing is something users
actually ask for, and the Activity Bar's prominence is worth the now-larger cost — right now `3c` was
solving for a three-explorer future using only one real explorer to justify it.

**A left rail inside the webview.** Same single-tab constraint as the tab strip, but spends ~240px of
panel width permanently on navigation VS Code's own sidebar already provides, and the panel is already
width-constrained after 0013's column grid. Rejected as the worst of both: native chrome duplicated,
native benefits (split view, Activity Bar discovery) still forfeited.

**Showing live counts on the Application Factory / Platform Event tabs**, matching what the design
canvas mock draws. Rejected for the same reason `3c`'s tree draft was corrected during review: neither
explorer exists, so any number shown would be fabricated, not scanned. `Coming soon` costs nothing and
still answers "what is this extension for" without the tab strip ever lying about data it doesn't have.

**Hiding the unbuilt explorers until they exist.** Cleaner, no dead tabs. Rejected: the placeholders are
the cheapest answer available to the discovery problem this doc opens with, provided they're visibly
inert rather than clickable-then-erroring — same reasoning `3c`'s draft already established for its tree
placeholders.

## Implementation plan

1. `src/webview/Icon.svelte` — three new glyphs: `domainProcess`, `applicationFactory`, `platformEvent`.
   Hand-drawn SVG paths, matching the existing `crown`/`edit`/`async` pattern — no new dependency (the
   webview has never loaded the codicon font; adding it for three glyphs isn't worth a new asset
   pipeline).
2. `src/webview/types.ts` — `InitialState`'s `data` variant gains `sourceLabel: string`.
3. `src/domainProcessBindingPanel.ts` — a `sourceLabel()` helper (org username, or each source dir run
   through `vscode.workspace.asRelativePath`, joined); `toInitialState` passes it through; panel title
   `AT4DX Bindings` → `AT4DX Explorer` (both where `createWebviewPanel` sets it and where the
   constructor re-sets it).
4. `src/webview/App.svelte` — the `.explorer-tabs` bar (markup + `:global` CSS), reusing the existing
   full-bleed-bar pattern already established by `.form-context-bar`/`.form-scope-strip`
   (`margin: -16px -16px 16px`). Rendered unconditionally, above `#summary`, in every `initial.kind`.
5. `test/webview/App.test.ts` — strip renders in every state; only two tabs read `Coming soon`; no
   badge before there's data; badge value and source label once there is.
6. This doc → `docs/design/`, plus its index row in `docs/design/README.md`.
7. `extensions/simply-at4dx/README.md` + `CHANGELOG.md` — user-facing.

No changes to `at4dxCli.ts`, `logger.ts`, the webview message protocol, `package.json`, or
`domainProcessBindingPanel.ts`'s message-handling logic.

## Testing

**Automated** (`vitest`) — entirely in the unit tier established by `docs/design/0010`; nothing here
touches `activate`, `registerCommand`, or a `TreeDataProvider`, so (unlike `3c`) there's no boundary to
work around:
- All three tabs render, in every `initial.kind` (loading/error/empty/data), with exactly two reading
  `Coming soon`.
- No `.explorer-tab-badge` renders before `initial.kind === 'data'`.
- Once there's data: the badge shows the current SObject + family's binding count, and the source label
  renders from `initial.sourceLabel`.
- Compile: `tsc --noEmit` and `svelte-check` — both clean.

**Manual** (F5, Extension Development Host):
- Panel opens titled `AT4DX Explorer`; tab strip shows all three tabs; the two placeholders are visibly
  inert and do nothing when clicked.
- Scan a workspace; the badge matches the current SObject/Trigger Event's binding count and updates as
  that selection changes.
- A connected-org scan shows the org username as the source label; a local/chosen-folder scan shows a
  workspace-relative path.
- A long source path truncates with an ellipsis rather than pushing the tabs around; the full value is
  in the label's `title`.
- Light and high-contrast themes: the active tab's underline, the badge, and the dimmed placeholder tabs
  all stay legible.

## Open questions

1. **The badge shows the current SObject + family's count, not the whole scan's.** That's what's
   already computed and on-screen (`bindingCount`, same number the header sentence states) — cheap and
   consistent, but it does mean the badge changes as the user changes SObject, which could read as "this
   explorer only has 3 bindings total" to someone glancing at just the tab. `rows.length` (the whole
   scan) is equally cheap if the total reads better in practice.
2. **What happens to this tab strip once a second explorer is real?** This doc leaves tab-switching
   unbuilt because there's nothing to switch to yet. Building Application Factory or Platform Event
   Distributor will force the question: does the same webview learn to render either explorer depending
   on which tab is active, or does each explorer stay its own command/panel with this strip reused
   across them? Not resolved here.
3. **Renaming the panel title to `AT4DX Explorer`** ahead of a second explorer existing is a small,
   reversible bet that the tab strip already makes "AT4DX Bindings" read stale. Revisit if it reads
   worse in practice than keeping the old title until there's something else to explore.
4. **Carried over, still open:** `Implements TriggerAction` workspace validation (deferred, wants its
   own doc), and the `Domain` third Type segment visible in the design canvas prototype but not in
   `DomainProcessType` — don't build it.
