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

## Troubleshooting

Every binding lookup logs a one-line summary (source, duration, outcome) to the
**AT4DX Domain Process Bindings** output channel (View → Output, then pick it from the dropdown) —
no setup needed. If something's failing and you need to share more detail in a bug report, turn on
the **`simply-at4dx.debug`** setting, reproduce the problem, and copy the channel's contents: with it
on, entries also include the org/source detail and captured error output. It's off by default since
that detail can include org usernames and local file paths.
