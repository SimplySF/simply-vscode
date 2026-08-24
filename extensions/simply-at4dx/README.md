# Simply AT4DX for Visual Studio Code

Explore [AT4DX](https://github.com/apex-enterprise-patterns/at4dx) Trigger Action Framework
bindings (`DomainProcessBinding__mdt`) for an SObject — grouped by trigger event, sorted by
execution order, with each criteria/action class's active state and async flag — without leaving
VS Code.

## Requirements

- The [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) on your `PATH`.
- The [`@simplysf/simply-aep`](https://www.npmjs.com/package/@simplysf/simply-aep) `sf` plugin:
  `sf plugins install @simplysf/simply-aep`.
- A Salesforce DX project open as a workspace folder, containing AT4DX's Trigger Action Framework
  metadata locally, or an authenticated org connection to read it from.

## Usage

Run **AT4DX: Show Domain Process Bindings** from the Command Palette. You'll be prompted to:

1. Pick a workspace folder (if more than one is open).
2. Pick where to read bindings from — local source, or a connected org.
3. Pick an SObject.
4. Pick a trigger event (Created/Updated/Deleted/Undeleted) or Domain Method Execution.

The resulting panel groups bindings into Before/After sections in execution order. Click a row to
open its class. A binding is data straight from
`sf simply aep at4dx domain-process-binding list --json` — this extension doesn't read or write
Salesforce metadata itself.
