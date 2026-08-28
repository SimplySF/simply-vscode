# Simply AT4DX for Visual Studio Code

Explore [AT4DX](https://github.com/apex-enterprise-patterns/at4dx) Trigger Action Framework
bindings (`DomainProcessBinding__mdt`) for an SObject — grouped by trigger event, sorted by
execution order, with each criteria/action class's active state and async flag — without leaving
VS Code.

## Requirements

- VS Code 1.119.0 or later. This extension depends on `@salesforce/core` and
  `@simplysf/simply-aep-core`, both of which require Node.js 22+ at runtime — VS Code has only bundled
  Node 22 since 1.119.0 (see `docs/design/0006`).
- A Salesforce DX project open as a workspace folder, containing AT4DX's Trigger Action Framework
  metadata locally, or an authenticated org connection to read it from. Authenticating an org is
  still done with the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli)
  (`sf org login web`, etc.) — this extension reads the auth files that produces, but doesn't require
  `sf` itself to be installed to run its own command.

## Usage

Run **AT4DX: Show Domain Process Bindings** from the Command Palette. You'll be prompted to:

1. Pick a workspace folder (if more than one is open).
2. Pick where to read bindings from — the whole workspace, a specific folder you browse to (handy
   for a multi-package-directory project), or a connected org. The connected-org list is read
   directly from your local Salesforce CLI auth files, not by shelling out to `sf org list`.

The panel then opens right away, with its SObject and Trigger Event dropdowns disabled while it
scans. Once the scan completes, the dropdowns populate and enable — pick an SObject, then a trigger
event (Created/Updated/Deleted/Undeleted) or Domain Method Execution, and the panel groups that
SObject's bindings into Before/After sections in execution order. Switching either dropdown re-renders
instantly, with no re-scan. Click a row to open its class. Bindings are read via
[`@simplysf/simply-aep-core`](https://www.npmjs.com/package/@simplysf/simply-aep-core) — the same
scan/resolve logic `sf simply aep at4dx domain-process-binding list` itself uses, imported directly
rather than shelling out to that command.

Each row also shows two dimmed-when-off indicators, next to the async marker: whether the binding
prevents recursive re-entry (Prevent Recursive), and whether it inverts its criteria's result (Logical
Inverse). Both render in every row, on or off, so a whole section can be scanned at a glance — hover
either icon for the exact state.

### Validation

Every scan is also validated, automatically — there's no separate command and nothing to turn on.
A summary bar above the dropdowns reads `✓ No problems found`, or `⚠ N errors · M warnings` split
into "in this SObject" and "elsewhere in this scan" so a clean-looking selection is never masking a
problem under a different SObject; clicking it scrolls to the Issues section. Any row with a problem
gets a colored badge naming it. Below the binding sections, an Issues section lists every problem
found, including ones that can't appear as a row at all — a binding with no SObject reference, for
example, is dropped from the SObject list entirely and only ever shows up here. Clicking a local
issue opens its `.md-meta.xml` beside the panel; org-sourced issues aren't clickable, since there's
no local file to open. See `docs/design/0007-at4dx-validate-viewed-bindings.md` for the full design,
and `testfixtures/` for a source tree exercising every rule.

### Creating and editing bindings

Click **+ New Binding** in the panel toolbar to add a binding, prefilled with the SObject you're
currently viewing, or click the pencil icon on any row to edit that binding. Either opens a form for
every `DomainProcessBinding__mdt` field — Developer Name is fixed once you're editing an existing
record, since renaming one is really a delete-and-recreate from Salesforce's own perspective.

Saving writes to whatever you picked when you opened the panel: a local folder gets its
`.md-meta.xml` file created or updated on disk; a connected org gets the equivalent record deployed
directly, with nothing left in your workspace. If the write would introduce a wiring problem AT4DX
validation already knows how to catch — an order collision, a duplicate Developer Name, and so on —
the form stays open with the issue(s) shown and the button becomes **Save Anyway**, so you can push
through deliberately instead of guessing why nothing happened. A successful save re-scans and
refreshes the panel immediately, so the new or changed binding (and anything it now flags) shows up
right away. See `docs/design/0009-at4dx-create-edit-domain-process-bindings.md` for the full design.

## Troubleshooting

Every binding lookup logs a one-line summary (source, duration, outcome) to the
**AT4DX Domain Process Bindings** output channel (View → Output, then pick it from the dropdown) —
no setup needed. If something's failing and you need to share more detail in a bug report, turn on
the **`simply-at4dx.debug`** setting, reproduce the problem, and copy the channel's contents: with it
on, entries also include the org/source detail and captured error output. It's off by default since
that detail can include org usernames and local file paths.

## Development

The panel's UI is a [Svelte 5](https://svelte.dev/) component tree under `src/webview/`, compiled by
`esbuild.js` into `dist/webview.js` alongside the extension host's own `dist/extension.js`; `npm run
compile`/`watch` build both together. See `docs/design/0011-at4dx-svelte-webview.md` for why.
