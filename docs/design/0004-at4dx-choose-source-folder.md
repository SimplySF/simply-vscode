# 0004 — AT4DX Choose Source Folder

**Status:** Implemented (PR #9)
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-25

## Problem

"Local Source" always scans the entire workspace folder (`getDomainProcessBindings` is called with
`dirs: [workspaceFolder.uri.fsPath]`). `BindingSource`'s `source` variant already supports multiple
directories (`dirs: string[]`), but nothing in the UI lets a user narrow the scan to a specific
directory — a particular `packageDirectory` in a multi-package SFDX project, or any other subfolder —
short of opening a different workspace folder entirely.

## Decision

Add a third choice to the binding-source picker — "Choose Source Folder…" — that opens a native
folder-browse dialog (`vscode.window.showOpenDialog`, defaulting to the workspace folder) and scans
just the selected directory. "Local Source" (whole workspace) and "Connected Org…" are unchanged.

Single-directory selection only for v1 — `BindingSource.dirs` already supports an array, but nothing
today asks for more than one at a time, and there's no request driving multi-select yet.

## Behavior

```
pick workspace folder
pick binding source:
  $(folder) Local Source              → dirs: [workspaceFolder]   (unchanged)
  $(folder-opened) Choose Source Folder…  → native folder dialog, defaultUri = workspaceFolder
                                            → dirs: [<picked folder>]
                                            (dialog cancelled → back to nothing selected, same as
                                             cancelling any other pick in this flow)
  $(cloud) Connected Org…             → unchanged
```

The picked folder isn't validated as being inside the workspace — `sf --source-dir` accepts any valid
path, and adding a workspace-containment check would be scope the ask didn't call for.

## Alternatives considered

**Reading `sfdx-project.json`'s `packageDirectories` and offering those as QuickPick choices**, instead
of a native folder dialog. Would fit typical SFDX project structure well and needs no OS dialog, but
was explicitly not the direction chosen — a folder dialog isn't limited to what's declared there (e.g.
a directory outside `packageDirectories` someone still wants to scan), and needs no `sfdx-project.json`
parsing/error-handling for a malformed or absent file.

**A free-text path input box.** Rejected: no validation or autocomplete, easy to typo a path with no
feedback until the scan fails.

**Multi-select folder picking for v1.** Deferred — `dirs: string[]` already supports it on the data
side, so this is a small follow-up if/when someone actually wants to scan several directories in one
run, not a redesign.

## Implementation plan

1. `src/extension.ts` (`pickBindingSource`): add the `Choose Source Folder…` item to
   `sourceKindItems`; on selection, call `vscode.window.showOpenDialog({ canSelectFolders: true,
   canSelectFiles: false, canSelectMany: false, defaultUri: workspaceFolder.uri, openLabel: 'Select
   Source Directory' })` and return `{ kind: 'source', dirs: [result[0].fsPath] }`, or `undefined` if
   the dialog is cancelled.
2. `README.md` — mention the new choice in the Usage section.
3. No changes to `at4dxCli.ts` or `domainProcessBindingPanel.ts` — `BindingSource` already supports
   this shape.

## Testing

Manual only (no automated extension test harness yet — same gap flagged since 0001):

- Pick "Choose Source Folder…", select a subdirectory, confirm the panel scans only that directory.
- Cancel the folder dialog, confirm the flow returns to "nothing selected" the same way cancelling any
  other picker in this chain does (no panel opens).
- "Local Source" and "Connected Org…" behave exactly as before.

## Open questions

- **Remembering the last-picked folder** across runs (so re-running the command doesn't always default
  back to the workspace root in the dialog). Not designed here — v1 always defaults the dialog to the
  workspace folder.
- **Multi-select**, per Alternatives above — natural follow-up, not this doc's scope.
