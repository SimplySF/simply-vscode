# 0005 — AT4DX Org List via `@salesforce/core`

**Status:** Implemented (PR #10)
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-25

## Problem

`pickBindingSource`'s "Connected Org…" choice populates its QuickPick by shelling out to
`sf org list --json` (`extension.ts`'s `listOrgs`). That means:

- The picker requires the full Salesforce CLI on `PATH` just to enumerate org auth files that are
  already sitting on disk — a much heavier dependency than the lookup itself needs.
- Every open of the picker pays a process-spawn (already mitigated by only running it once the user
  picks "Connected Org…", per 0001, but still a ~seconds-scale `sf` cold start).
- Failure is opaque: today `listOrgs` swallows any error and returns `[]`, so "sf isn't installed"
  and "you have zero orgs" look identical to the user (an "orgs found: 0" info message either way).

`sf org list`'s own data — for the non-scratch/scratch org username+alias pairs this picker actually
uses — comes from reading local auth files, which `@salesforce/core` (the library the `sf` CLI and
its plugins are themselves built on) already exposes as an in-process API. Note this plan only
touches `listOrgs`; `at4dxCli.ts`'s shell-out to `sf simply aep at4dx domain-process-binding list
--json` is unaffected — 0001 already decided to keep that one CLI-based, since there's no local
equivalent for a custom `simply-aep` plugin command.

## Decision

Replace `listOrgs`'s `execa`/`sf org list --json` shell-out with `@salesforce/core`'s
`AuthInfo.listAllAuthorizations()`, called in-process:

```typescript
import { AuthInfo } from '@salesforce/core';

const orgs = await AuthInfo.listAllAuthorizations((org) => !org.error);
```

This returns `OrgAuthorization[]` (`username`, `aliases: string[] | null`, `isScratchOrg`,
`isExpired`, `error`, …) read straight from the same auth files `sf org list` reads — no subprocess,
no `PATH` dependency, no 30s timeout/ENOENT handling to write.

**This requires setting `process.env.SF_DISABLE_LOG_FILE = 'true'` before the first
`@salesforce/core` call**, done once at module load in the file that imports it. See Testing below
for why: `@salesforce/core`'s `Logger` constructs a `pino` instance with a worker-thread file
transport (`lib/logger/transformStream.js`, referenced by relative path) unless that env var is set,
and that transport doesn't survive esbuild bundling into a single file — it works fine unbundled,
but throws at runtime once inlined. `Logger`'s own constructor treats the env var as "use an in-memory
sink instead," which sidesteps the worker-thread transport entirely and was confirmed (see Testing) to
work correctly in the fully-bundled build. This mirrors the existing pattern in `at4dxCli.ts` of
setting `SF_AUTOUPDATE_DISABLE`/`SF_DISABLE_TELEMETRY` env vars around `sf` calls — same idea, just an
in-process env var instead of a subprocess one.

The accepted trade-off is bundle size: adding `@salesforce/core` grows `dist/extension.js` from
~138 KB to ~2.9 MB (production/minified — see Testing). That's because importing anything from
`@salesforce/core`'s barrel export pulls in its `Connection`/`Org`/jsforce machinery even though
`AuthInfo.listAllAuthorizations()` never makes a network call — esbuild has no way to tree-shake a
CommonJS/mixed package's barrel export down to the one class actually used. Judged worth it here:
removing the `sf`-on-`PATH` requirement and shell-out latency for a UI path a user can hit every time
they open the picker outweighs a few extra MB in a `.vsix` nobody downloads over a metered connection.

## Behavior

No user-visible change to the QuickPick flow — "Connected Org…" still lists `$(cloud) alias/username`
entries and falls back to "No connected orgs found." on empty. Two small, deliberate differences from
today:

- Orgs with `error` set (broken/corrupted auth file) are filtered out via the `orgAuthFilter`
  argument — `sf org list` would still list these with a failed `connectedStatus`, but this picker
  has never shown connection status, and an org whose auth file failed to parse isn't a usable pick.
- Expired orgs (`isExpired: true`) are **not** filtered — same as today, where `sf org list` returns
  them and the picker doesn't distinguish. Picking one still surfaces a normal auth error the next
  time it's actually used (unchanged failure mode, just deferred to point of use instead of
  point of listing).

## Alternatives considered

**Leave `sf org list` as-is (status quo).** This is what's being changed; noted for completeness —
rejected because it's the dependency and latency problem described above.

**Keep `@salesforce/core` external in esbuild and stop using `vsce package --no-dependencies` for
this extension** (i.e., ship `node_modules`, matching how most non-bundled VS Code extensions
package). Rejected: this repo's `--no-dependencies` + single-bundle-file convention is shared release
tooling (`RELEASING.md`), and carving out a packaging exception for one extension is a bigger,
farther-reaching change than the actual problem needs — especially once `SF_DISABLE_LOG_FILE` turned
out to make full bundling work without it.

**`@salesforce/sf-plugins-core`.** Rejected: that package is for building `sf` CLI plugins
themselves (shared flags, UX helpers) — it's not a data API and doesn't expose an org-listing
function; `@salesforce/core` is the actual library it and `sf org list` build on.

**Reading `~/.sf`/`~/.sfdx` auth files directly.** Rejected: reimplements what `AuthInfo` already
does correctly (decryption, alias resolution, config-file cross-referencing), and would silently
break on any future auth-file format change `@salesforce/core` absorbs internally.

## Implementation plan

1. **`extensions/simply-at4dx/package.json`** — add `@salesforce/core` as a dependency (already done
   as part of this doc's spike; see Testing). `execa` stays — `at4dxCli.ts` still needs it.
2. **`src/extension.ts`** — replace `listOrgs`'s `execa`/`sf org list` block:
   - Static `import { AuthInfo } from '@salesforce/core';` at the top (no dynamic-import dance needed
     — unlike `execa`, `@salesforce/core` isn't ESM-only, so `tsc` is fine with a plain static import;
     confirmed during the spike).
   - Set `process.env.SF_DISABLE_LOG_FILE = 'true'` once at module load, before any `AuthInfo` call
     (it gates a singleton logger constructed on first use, so it must be set before that point).
   - Call `AuthInfo.listAllAuthorizations((org) => !org.error)`, map `OrgAuthorization[]` →
     the existing `OrgSummary[]` shape (`username`, `alias: aliases?.[0]`).
   - Simplify the surrounding try/catch: no more ENOENT/timeout/stdout/stderr subprocess branches,
     just success/failure of the in-process call, keeping the existing `logger.log(...)` summary line
     shape from 0002 (outcome + elapsed ms).
3. **`README.md`/`CHANGELOG.md`** — note that the org picker no longer requires the Salesforce CLI on
   `PATH` (only the bindings-list step still does).
4. **Manual verification** — F5 into the Extension Development Host, run
   **AT4DX: Show Domain Process Bindings**, confirm "Connected Org…" lists the same orgs as
   `sf org list --json` does on a real machine, and check the zero-orgs and all-expired-or-errored
   cases.
5. **Update this doc's Status** to `Implemented` (with the PR link) once merged, and add its row to
   `docs/design/README.md`'s index.

## Testing

**Done, as a pre-implementation spike (this doc):**

- `npm install @salesforce/core --workspace=extensions/simply-at4dx` — installs clean, 98 packages
  added. (`keytar` shows up in `npm ls` but is a pre-existing transitive dependency of
  `@vscode/vsce`, unrelated to this change.)
- Bundling a throwaway `import { AuthInfo } from '@salesforce/core'` with the extension's actual
  `esbuild.js` config (`bundle: true`, `external: ['vscode']` only) produced **zero errors, zero
  warnings** — the widely-known "esbuild chokes on a `@salesforce/*` package's dynamic requires"
  failure mode (usually from `proxy-agent`'s PAC-file support) did not occur here; confirmed via the
  bundle's metafile that `pac-resolver`/`degenerator` never get pulled in by
  `AuthInfo.listAllAuthorizations()`'s code path (only `@jsforce/jsforce-node`'s bundled `undici`
  comes along, dead code never executed since this call makes no network request).
- **Running the bundled output crashed at runtime**, despite the clean build: `Error: unable to
  determine transport target for "..\..\lib\logger\transformStream"`, thrown from `pino`'s transport
  setup the first time `@salesforce/core`'s `Logger` singleton is constructed (triggered merely by
  calling `AuthInfo.listAllAuthorizations()`, nothing logging-specific in our own code). Root cause
  confirmed by re-running with `@salesforce/core` marked `external` (so it resolves from a real,
  unbundled `node_modules` on disk instead) — same call succeeded immediately, isolating the failure
  to bundling specifically, not the API itself.
- Reading `@salesforce/core`'s `lib/logger/logger.js` found the fix: its `Logger` constructor checks
  `process.env.SFDX_DISABLE_LOG_FILE`/`SF_DISABLE_LOG_FILE` and, when either is `'true'`, uses an
  in-memory `pino` sink instead of building the file-transport pipeline at all. Re-ran the **fully
  bundled** build with `SF_DISABLE_LOG_FILE=true` set — `AuthInfo.listAllAuthorizations()` returned
  correctly, no crash. This is the fix captured in Decision above.
- Bundle size measured: current production `dist/extension.js` is 141,401 bytes; a minified
  production build with `AuthInfo` alone imported from `@salesforce/core` is 2,962,996 bytes. This is
  the number behind the size trade-off called out in Decision.
- `tsc --noEmit -p .` had no complaints about the static `@salesforce/core` import (unlike `execa`,
  no `resolution-mode` type-import workaround needed).
- Spike scratch files (`src/_spike.ts`, throwaway `dist/_spike*` bundles) were removed after
  confirming the above; the `package.json`/`package-lock.json` dependency addition was left in place
  since it's the actual change this doc calls for, not spike-only scaffolding.

**Done, as the actual implementation (PR #10):** `listOrgs` in `extension.ts` now calls
`AuthInfo.listAllAuthorizations()` per Decision above; `npm run compile` passes clean, and the real
bundled `dist/extension.js` (with `vscode` stubbed) was loaded directly to confirm the module
initializes and the `SF_DISABLE_LOG_FILE` fix takes effect against this machine's real auth files.

**Not done yet:** a manual Extension Development Host smoke test (F5) of the "Connected Org…" picker
against a real workspace — tracked in the PR's test plan checklist.

## Open questions

- **Bundle size growth (~138 KB → ~2.9 MB).** Accepted for now (see Decision); worth revisiting if
  a future change adds more `@salesforce/*` packages and the cumulative size becomes a real concern
  for `.vsix` install time or Marketplace listing size limits.
- **`SF_DISABLE_LOG_FILE` is a process-wide env var**, not scoped to this one call the way `execa`'s
  per-subprocess `env` override was. Harmless today (nothing else in this extension host process
  writes `sf`/`sfdx` log files), but worth remembering if a future extension in this same host also
  imports `@salesforce/core` and *wants* file logging — this would silently disable it for that
  extension too, since `Logger.rootLogger` is a singleton and env vars are process-global.
- **Filtering `isExpired` orgs from the picker.** Left unfiltered to match today's behavior (see
  Behavior); could be revisited as a small UX improvement (grey out or annotate expired orgs) once
  someone actually hits it, but out of scope for this doc.
- **Node.js version floor** — not identified as a risk when this doc was written; found and resolved
  in [0006](0006-at4dx-direct-library-imports.md#open-questions) once a second `@salesforce/*`-derived
  dependency made it worth checking. `@salesforce/core` itself already declared `engines.node
  >=22.0.0` at the time this PR shipped, unnoticed. Resolved retroactively by 0006's `engines.vscode`
  bump to `^1.119.0`, which applies to this extension as a whole, not just the code 0006 added.
