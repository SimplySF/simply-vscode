# 0008 — AT4DX Default Source Folder

**Status:** Draft
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-26

## Problem

"Local Source" (added in 0004) scans `workspaceFolder.uri.fsPath` — the whole workspace root. For a
real SFDX project that's rarely where AT4DX metadata actually lives: a multi-package-directory project
keeps it under a package directory (`force-app`, `sfdx-source`, or whatever `sfdx-project.json`
declares), and scanning the workspace root pulls in every sibling package directory and non-Salesforce
config alongside it.

## Decision

Before scanning, resolve a best-guess source directory and use it as "Local Source"'s scan target
(and the description shown next to it in the picker) instead of the workspace root:

1. Read `sfdx-project.json` via `SfProject` (`@salesforce/core`, already a dependency — used for
   `AuthInfo` today) and use its default package directory (`packageDirectories` entry with
   `default: true`, or the first entry if none is marked) if the project resolves and that directory
   exists on disk.
2. Otherwise, look for a directory literally named `sfdx-source` or `force-app` directly under the
   workspace folder (in that order) and use the first one found.
3. Otherwise, fall back to the workspace folder itself — today's behavior.

"Choose Source Folder…" is unchanged — its browse dialog still starts at the workspace root
(`defaultUri: workspaceFolder.uri`), same as before this doc. It's a full folder browser already, so
someone reaching for it has narrowing as the explicit goal and can navigate anywhere, including outside
`packageDirectories` entirely (0004 already decided a picked folder isn't validated as being inside the
workspace).

## Behavior

```
pick "Local Source"
  → resolve source directory:
      sfdx-project.json default package directory (if it resolves and exists)
      else <workspaceFolder>/sfdx-source or <workspaceFolder>/force-app (first that exists)
      else workspaceFolder
  → scan <resolved> (no dialog — same as before, just a different directory)

pick "Choose Source Folder…"
  → showOpenDialog({ ..., defaultUri: workspaceFolder.uri })   (unchanged)
```

Resolution failures (no `sfdx-project.json`, malformed file, no `packageDirectories`, resolved path
doesn't exist) are silent fallthrough to the next rule — this is a UX nicety, not something worth
surfacing an error or a log line for.

## Alternatives considered

**Defaulting the "Choose Source Folder…" dialog's `defaultUri` instead of changing "Local Source".**
This was the original version of this doc. Rejected on reconsideration: "Choose Source Folder…" already
lets someone browse anywhere, so a smarter starting point only saves a few clicks on the occasional run.
"Local Source" is the common path (no dialog, used every time bindings are viewed without narrowing),
and scanning the wrong directory there is the actual daily friction — that's what this doc now targets.

**Offering `packageDirectories` entries as QuickPick choices**, replacing or augmenting "Local Source"
or the folder dialog. This is what 0004 already rejected for the folder dialog, for the same reason: a
folder dialog isn't limited to what's declared there. Doing this for "Local Source" would also add a
picker step to what's meant to be the instant, one-click option — rejected for the same "always instant"
reasoning 0004 gave for "Local Source" existing at all.

**Remembering the last folder picked** for "Choose Source Folder…", instead of (or in addition to)
resolving from `sfdx-project.json`. Deferred — this was already an open question in 0004 and is still a
reasonable follow-up, but it solves a different problem (repeat runs of the folder dialog) than this doc
(the default "Local Source" scan target).

## Implementation plan

1. `src/extension.ts` (`pickBindingSource`): add a `resolveDefaultSourceDir(workspaceFolder)` helper
   that implements the three-step resolution above using `SfProject.resolve` and `fs.existsSync`, call
   it once up front, and use its result both as the `'local'` branch's scan `dirs` and as the "Local
   Source" QuickPick item's `description` (replacing `workspaceFolder.uri.fsPath` in both places). The
   `localFolder` branch's `showOpenDialog` keeps `defaultUri: workspaceFolder.uri`.
2. `README.md` — no behavior a user picks changes (still "Local Source" vs. "Choose Source Folder…" vs.
   "Connected Org…"), only what "Local Source" scans; not worth a line, given the existing Usage section
   doesn't document the exact scan root today either.

## Testing

Manual only (same gap flagged since 0001):

- Workspace with a `sfdx-project.json` marking a non-default-named package directory `default: true` —
  confirm "Local Source" scans there and the picker description shows that path.
- Workspace with no `sfdx-project.json` but a `force-app` folder — confirm it scans there.
- Workspace with neither — confirm "Local Source" scans the workspace root (today's behavior,
  unchanged).
- "Choose Source Folder…" and "Connected Org…" behave exactly as before — dialog still opens at the
  workspace root.

## Open questions

- **Remembering the last-picked folder** for "Choose Source Folder…" across runs — still open, carried
  over from 0004, not addressed here.
