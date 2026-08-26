# 0008 — AT4DX Default Source Folder

**Status:** Draft
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-26

## Problem

"Choose Source Folder…" (added in 0004) opens `vscode.window.showOpenDialog` with
`defaultUri: workspaceFolder.uri` — the dialog always starts at the workspace root. For a real SFDX
project that's rarely the directory someone actually wants: they're narrowing the scan to a package
directory (`force-app`, `sfdx-source`, or whatever `sfdx-project.json` declares), and the workspace
root is usually a handful of config files and package directories siblings-deep from anything
AT4DX-relevant. Starting the browse dialog there just adds clicks every time.

## Decision

Before opening the folder dialog, resolve a best-guess starting directory and pass it as `defaultUri`
instead of the workspace root:

1. Read `sfdx-project.json` via `SfProject` (`@salesforce/core`, already a dependency — used for
   `AuthInfo` today) and use its default package directory (`packageDirectories` entry with
   `default: true`, or the first entry if none is marked) if the project resolves and that directory
   exists on disk.
2. Otherwise, look for a directory literally named `sfdx-source` or `force-app` directly under the
   workspace folder (in that order) and use the first one found.
3. Otherwise, fall back to the workspace folder itself — today's behavior.

This only changes where the dialog *starts*; it's still a full folder browser, so nothing stops
someone from navigating anywhere else, including outside `packageDirectories` entirely (0004 already
decided a picked folder isn't validated as being inside the workspace).

"Local Source" is unchanged — it intentionally scans the whole workspace folder (0004), so there's no
dialog and nothing to default.

## Behavior

```
pick "Choose Source Folder…"
  → resolve starting directory:
      sfdx-project.json default package directory (if it resolves and exists)
      else <workspaceFolder>/sfdx-source or <workspaceFolder>/force-app (first that exists)
      else workspaceFolder
  → showOpenDialog({ ..., defaultUri: <resolved> })
```

Resolution failures (no `sfdx-project.json`, malformed file, no `packageDirectories`, resolved path
doesn't exist) are silent fallthrough to the next rule — this is a UX nicety, not something worth
surfacing an error or a log line for.

## Alternatives considered

**Offering `packageDirectories` entries as QuickPick choices**, replacing or augmenting the folder
dialog. This is exactly what 0004 already rejected, for the same reason: a folder dialog isn't limited
to what's declared there, and this doc doesn't revisit that call — it only changes where the dialog
*starts*.

**Also changing "Local Source" to scan the default package directory instead of the whole workspace.**
Rejected — "Local Source" scanning the whole workspace is intentional (0004), and someone reaching for
"Choose Source Folder…" already has narrowing as the explicit goal. Conflating the two would be a
behavior change to "Local Source" nobody asked for.

**Remembering the last folder picked**, instead of (or in addition to) resolving from
`sfdx-project.json`. Deferred — this was already an open question in 0004 and is still a reasonable
follow-up, but it solves a different problem (repeat runs) than this doc (first run, or any run
against a project that was never browsed before).

## Implementation plan

1. `src/extension.ts` (`pickBindingSource`): add a `resolveDefaultSourceDir(workspaceFolder)` helper
   that implements the three-step resolution above using `SfProject.resolve` and `fs.existsSync`
   (or `vscode.workspace.fs.stat`), and pass its result as `defaultUri` to `showOpenDialog` in the
   `localFolder` branch instead of `workspaceFolder.uri`.
2. `README.md` — no behavior a user picks changes, only where a dialog starts; not worth a line, given
   the existing Usage section already just says "a specific folder you browse to."

## Testing

Manual only (same gap flagged since 0001):

- Workspace with a `sfdx-project.json` marking a non-default-named package directory `default: true` —
  confirm "Choose Source Folder…" opens there.
- Workspace with no `sfdx-project.json` but a `force-app` folder — confirm it opens there.
- Workspace with neither — confirm it falls back to the workspace root (today's behavior, unchanged).
- "Local Source" and "Connected Org…" behave exactly as before.

## Open questions

- **Remembering the last-picked folder** across runs — still open, carried over from 0004, not
  addressed here.
