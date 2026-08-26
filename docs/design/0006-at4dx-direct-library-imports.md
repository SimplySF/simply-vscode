# 0006 — AT4DX Domain Process Bindings via Direct Library Imports

**Status:** Implemented (PR #11)
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-25

## Problem

`at4dxCli.ts`'s `getDomainProcessBindings` shells out to
`sf simply aep at4dx domain-process-binding list --json` — the one piece of this extension's data
path 0001 deliberately kept CLI-based, on the reasoning that reimplementing AT4DX's CMDT scan/resolve
logic in this extension would duplicate it in two languages/repos that would drift apart, for a
command that "already exists."

That reasoning no longer holds. The companion `simply` (CLI) repo has since split that exact logic out
into `@simplysf/simply-aep-core` — a plain npm library, published standalone, whose own design doc
([0009 in `simply-node`](https://github.com/SimplySF/simply-node/blob/main/docs/design/0009-aep-library-consumption.md))
names *this extension* as the reason it exists: "a companion VS Code extension
(`simply-vscode/extensions/simply-at4dx`) could import the AT4DX scan/resolve functions and row types
directly instead of shelling out." There is now exactly one implementation of the resolution rules
either way — the CLI's own `domain-process-binding list` command imports from `simply-aep-core` too
(see `packages/simply-aep/src/commands/simply/aep/at4dx/domain-process-binding/list.ts` in the
`simply` repo) — so importing it directly here doesn't fork anything; it removes a layer.

Concretely, staying on the shell-out costs:

- **`sf` and the `simply-aep` plugin must be installed** just to run logic that's now a plain,
  publishable dependency — a heavier ask than the data itself needs, and (combined with 0005, which
  already removed this requirement for the org picker) the last thing in this extension still forcing
  that requirement.
- **A subprocess per lookup**, with ENOENT/timeout/JSON-parse/plugin-not-installed failure modes that
  all disappear if the call happens in-process.
- **A duplicated type mirror** (`at4dxCli.ts`'s `DomainProcessBindingRow` and friends, `at4dxCli.ts:7-45`)
  that has to be hand-kept in sync with `simply-aep-core`'s real types — 0001's own Open Questions
  flagged this as a known, accepted-for-now liability.

## Decision

Replace the shell-out in `at4dxCli.ts` with direct imports from `@simplysf/simply-aep-core`:
`scanLocalDomainProcessBindings`, `scanOrgDomainProcessBindings`, and `resolveDomainProcessBindings`.
Since that package's public API is deliberately just scan/resolve primitives — not a full command —
`at4dxCli.ts` takes over the small amount of orchestration currently living in `simply-aep`'s CLI
command file: choosing org vs. local, building the org `Connection`, applying the optional SObject
filter before resolving, and translating failures into user-facing messages equivalent to that
command's own (`error.at4dxNotDetected` / `error.localScanFailed` / `error.orgQueryFailed` in
`simply-aep`'s `messages/simply.aep.at4dx.domain-process-binding.list.md`).

For the org path, `scanOrgDomainProcessBindings` needs a `Connection`-shaped object
(`AepConnection = Pick<Connection, 'autoFetchQuery' | 'getUsername'>`). Build one the same way 0005's
`listOrgs` already reasons about auth: `AuthInfo.create({ username })` →
`Connection.create({ authInfo })`, both from `@salesforce/core` — already a dependency of this
extension as of 0005, so this adds no new `@salesforce/core`-vs.-version concern.

The `SF_DISABLE_LOG_FILE` fix 0005 introduced (`@salesforce/core`'s `Logger` singleton, worker-thread
`pino` transport breaking under esbuild's single-file bundle) applies here unchanged — it's set once,
at `extension.ts` module load, before any command can run, and covers every `@salesforce/core`-derived
package in the process, `simply-aep-core` included (confirmed in Testing below).

With this change and 0005 combined, **`simply-at4dx` no longer requires the Salesforce CLI or any
plugin installed at all** — `execa` becomes unused anywhere in the extension and is removed entirely.

## Behavior

No user-visible change to the command flow or panel. `at4dxCli.ts`'s public function keeps the same
job — resolved `DomainProcessBindingRow[]` in, `At4dxCliError` with a safe-to-show message out — just
sourced differently:

| Path | Old (shell-out) | New (direct import) |
| --- | --- | --- |
| Local source | `sf ... --source-dir <dir> ...` | `scanLocalDomainProcessBindings(dirs)` → filter → `resolveDomainProcessBindings` |
| Connected org | `sf ... --target-org <user> ...` | `AuthInfo.create` → `Connection.create` → `scanOrgDomainProcessBindings(connection)` → filter → `resolveDomainProcessBindings` |
| AT4DX not configured | CLI's `error.at4dxNotDetected`, passed through | Same message, thrown directly when local scan returns zero records or org scan reports `missing: true` |
| Local scan threw | CLI's `error.localScanFailed`, passed through | Same message shape: `` Failed to scan the project directory: ${error.message} `` |
| Org connection/auth failed (e.g. bad username) | Opaque — handled by `sf-plugins-core`'s flag parsing before the CLI's own command code ever ran | New, extension-specific: `` Failed to connect to the org: ${error.message} ``, kept distinct from the query failure below since it's a different step |
| Org query threw | CLI's `error.orgQueryFailed`, passed through | Same message shape: `` Failed to query bindings from the org: ${error.message} `` |
| `sf` not on PATH / plugin not installed / CLI timeout | Distinct `At4dxCliError` messages | **Gone** — no subprocess, so these failure modes no longer exist |

`getDomainProcessBindings`'s signature drops its `cwd` parameter — it existed only to set the spawned
`sf` process's working directory; `scanLocalDomainProcessBindings`/`Connection.create` need no such
thing, since `target.dirs`/`target.username` are already everything they need.

## Alternatives considered

**Leave the shell-out as-is (status quo).** This is what 0001 chose, for a reason (no library
existed) that `simply-aep-core` has since removed. Rejected as the thing this doc is changing.

**Depend on `@simplysf/simply-aep`** (the CLI package's own barrel) **instead of
`@simplysf/simply-aep-core`.** Rejected: that's exactly the shape `simply-node`'s 0009 fixed —
`simply-aep` pulls in `@oclif/core` and `@salesforce/sf-plugins-core` for its command framework, none
of which this extension needs, and its `index.ts` reverts to an empty stub as part of that same change
(no functions left to import from it going forward).

**Fork/reimplement the CMDT scan/resolve logic inside this extension**, avoiding an external
dependency on a pre-1.0 package. Rejected for the same reason 0001 rejected it the first time — two
implementations of AT4DX's resolution rules (priority ordering, order-collision detection) drifting
apart across repos — except now there's a maintained, purpose-built library to depend on instead, which
is a strictly better position than either forking or shelling out.

## Implementation plan

1. **`extensions/simply-at4dx/package.json`** — add `@simplysf/simply-aep-core` as a dependency;
   remove `execa` (both of the extension's `execa` call sites — this one and 0005's `listOrgs`, already
   migrated — are gone once this lands).
2. **Rewrite `src/at4dxCli.ts`**:
   - Drop the `execa`/`ExecaError` import and `describeCliFailure`.
   - Import `AuthInfo`, `Connection` from `@salesforce/core` (static import — already proven to work
     with this extension's `tsc`/esbuild setup by 0005) and
     `scanLocalDomainProcessBindings`, `scanOrgDomainProcessBindings`, `resolveDomainProcessBindings`,
     plus the real `DomainProcessBindingRow`/`RawDomainProcessBindingRecord` types, from
     `@simplysf/simply-aep-core` (dynamic `import()` — this package is ESM-only, same pattern `execa`
     used, with the same `resolution-mode: 'import'` type-import workaround for `tsc`). Delete the
     hand-mirrored types this file currently defines (`at4dxCli.ts:7-45`) now that the real types are
     importable directly — closes the Open Question 0001 raised about that mirror drifting.
   - Rewrite `getDomainProcessBindings(target, sobjects?, logger?)` (no more `cwd` parameter):
     - `target.kind === 'org'`: `AuthInfo.create({ username: target.username })` →
       `Connection.create({ authInfo })` → `scanOrgDomainProcessBindings(connection)`. On
       `missing: true`, throw `At4dxCliError` with the `error.at4dxNotDetected` copy below. On a thrown
       error, wrap as `` Failed to query bindings from the org: ${error.message} ``.
     - Otherwise: `scanLocalDomainProcessBindings(target.dirs)` in a try/catch, wrapping failures as
       `` Failed to scan the project directory: ${error.message} ``. Zero records also throws
       `at4dxNotDetected`.
     - Apply the optional `sobjects` filter (`Set` membership on `.sobject`) before calling
       `resolveDomainProcessBindings`, matching `simply-aep`'s own command order.
   - Message text ported from `simply-aep`'s
     `messages/simply.aep.at4dx.domain-process-binding.list.md`:
     - `error.at4dxNotDetected`: "AT4DX's Trigger Action Framework doesn't appear to be present in
       this source: the DomainProcessBinding__mdt Custom Metadata Type wasn't found."
     - `error.localScanFailed` / `error.orgQueryFailed`: same `Failed to {scan the project
       directory,query bindings from the org}: %s` shape, `%s` filled with the underlying error's
       message.
   - Logging: replace the old command/stdout/stderr/exitCode verbose logging with call parameters
     (org username, or source dirs, plus any sobject filter) and an outcome/duration summary line,
     keeping the existing `Logger` shape from 0002 unchanged.
3. **`src/extension.ts`** — update the one call site:
   `getDomainProcessBindings(workspaceFolder.uri.fsPath, target, undefined, logger)` →
   `getDomainProcessBindings(target, undefined, logger)`.
4. **`src/logger.ts`** — remove `baseCommand` (only meaningful for a CLI argument list; nothing calls
   it once this lands). Keep `truncate` (still useful for long error messages/stack traces) and
   `redactProxyUrl` (network calls to the org still go through `HTTPS_PROXY`/`HTTP_PROXY` if set).
5. **`README.md`** — drop the "Salesforce CLI (`sf`) on your PATH" and "`@simplysf/simply-aep` plugin"
   Requirements bullets entirely (nothing in the extension needs either anymore, combined with 0005);
   update the Usage section's "data straight from `sf simply aep at4dx domain-process-binding list
   --json`" line to describe the direct-import path instead.
6. **Manual verification** — F5 into the Extension Development Host: local-source path (including a
   directory with no AT4DX metadata, to check the `at4dxNotDetected` message), connected-org path
   against a real org, and a deliberately-broken case (e.g. an expired org auth) to check the
   `orgQueryFailed` message reads sensibly.
7. **Update this doc's Status** to `Implemented` (with the PR link), and cross-reference it from 0001's
   Alternatives-considered section — that section's reasoning for shelling out no longer applies and
   should point here rather than silently going stale.

## Testing

**Done, as a pre-implementation spike (this doc), mirroring 0005's approach:**

- Installed `@simplysf/simply-aep-core@0.2.0` (published; confirmed on the npm registry) into the
  `simply-at4dx` workspace alongside the already-present `@salesforce/core`.
- Bundled a throwaway file exercising both paths — `scanLocalDomainProcessBindings` +
  `resolveDomainProcessBindings`, and `AuthInfo.create` → `Connection.create` →
  `scanOrgDomainProcessBindings` + `resolveDomainProcessBindings` — with this extension's actual
  `esbuild.js` config. **Zero build errors or warnings**, same result as 0005's spike.
- **Running the bundle hit the identical `pino` worker-thread transport crash 0005 found**
  (`unable to determine transport target for "..\..\lib\logger\transformStream"`), confirming
  `simply-aep-core`'s own transitive `@salesforce/core` dependency constructs the same `Logger`
  singleton. **`SF_DISABLE_LOG_FILE=true` fixed it identically** — no new workaround needed, since
  0005 already sets this once at `extension.ts` module load, before any command runs.
- With that fix, re-ran both paths for real: `scanLocalDomainProcessBindings` against a local directory
  (empty result, correctly — no AT4DX metadata there), and the full live-org pipeline
  (`AuthInfo.create` → `Connection.create` → `scanOrgDomainProcessBindings` → `autoFetchQuery`'s actual
  SOQL against `DomainProcessBinding__mdt`) against one of this machine's real authenticated orgs —
  succeeded end-to-end in the bundled build. This specifically exercises `@salesforce/core`'s
  `Connection`/network/proxy-agent machinery, which 0005's spike never touched (it only used the
  local-file-only `AuthInfo.listAllAuthorizations`) — confirming that heavier codepath also survives
  bundling.
- **Bundle size**: combining `simply-aep-core` (which pulls in `@salesforce/source-deploy-retrieve`)
  with `@salesforce/core`'s `Connection` path measured ~5.4 MB minified for the throwaway spike file
  alone — larger than 0005's ~2.9 MB (`AuthInfo`-only) figure, since `Connection` additionally pulls in
  jsforce's proxy-agent chain (`degenerator`/`esprima`/`escodegen`/`quickjs-emscripten`, ~600 KB+ on
  its own) that the pure-local-auth-file path never touched. The actual `dist/extension.js` delta will
  differ somewhat from this estimate once integrated for real; worth re-measuring after implementation.
- Spike scratch files and the temporary dependency installs were reverted after confirming the above —
  nothing from this spike is committed; the actual dependency addition happens in Implementation plan
  step 1.

**Done, as the actual implementation (PR #11):** `at4dxCli.ts` rewritten per Decision/Implementation
plan above. `npm run compile` passes clean. Beyond the spike, the real rewrite was bundled standalone
and exercised against real local/org data for all four outcomes: local scan with no AT4DX metadata
(`at4dxNotDetected`), local scan against a nonexistent directory (`localScanFailed`, with the
underlying `TypeInferenceError` message threaded through), org scan against a real org that doesn't
have the CMDT type configured (`missing: true` → `at4dxNotDetected`), and org scan against a bogus
username (a new failure mode this doc's table didn't originally list: `AuthInfo.create` itself
throwing `NamedOrgNotFoundError`, wrapped as `` Failed to connect to the org: ${message} `` — kept
distinct from `orgQueryFailed` since it's a different failure, connection setup vs. the query itself).

**Not done yet:** a manual Extension Development Host smoke test (F5) of the full panel flow — tracked
in the PR's test plan checklist.

## Open questions

- ~~**Node.js version floor.**~~ **Resolved (2026-08-26):** both `@salesforce/core` and
  `@simplysf/simply-aep-core` declare `"engines": { "node": ">=22.0.0" }`, and VS Code only started
  bundling Node 22 as of **1.119.0 (2026-05-05)**. Rather than verify whether the compiled output
  actually calls a Node-22-only runtime API on older hosts, the decision made was to require it
  outright: `extensions/simply-at4dx/package.json`'s `engines.vscode` is bumped from `^1.85.0` to
  `^1.119.0` (and `@types/vscode` to match), so the Marketplace itself refuses to install this
  extension on a VS Code build that predates guaranteed Node 22 — turning a silent, unverified risk
  into an explicit, enforced compatibility floor. This is a real compatibility break for anyone on an
  older VS Code (worth its own conventional-commit `BREAKING CHANGE` footer), accepted as the
  trade-off for not having to chase down every Node-22-only API surface across two third-party
  dependency trees. Applies retroactively in spirit to 0005 as well, even though that PR already
  shipped under the old floor.
- **No timeout on the org-query path.** The old shell-out had `execa`'s `timeout: 30_000` as a safety
  net against a hung `sf` process. A direct `connection.autoFetchQuery` call has no equivalent — a
  hung network/proxy could block indefinitely. Worth an `AbortController`-based wrapper, but not
  designed here.
- **0002's debug output channel** was designed entirely around CLI-invocation semantics (command,
  args, working directory, captured stdout/stderr). Once there's no subprocess for the domain-process
  binding path either (0005 already removed it for the org picker), most of what that channel exists
  to show is gone. Worth a follow-up doc deciding what "debug" logging means now (call parameters?
  stack traces? `@salesforce/core`'s own log level?) — out of scope here.
- **`@simplysf/simply-aep-core` is pre-1.0** (`0.2.0`). Its README doesn't carry the same
  breaking-change discipline a 1.x semver would imply, despite `simply-node`'s 0009 doc committing to
  treat its exported surface as semver-covered. Pin conservatively (`^0.2.0`, not a wider range) and
  watch its release notes rather than assuming minor-version safety by default.
- **0001's Alternatives-considered section** currently documents "reimplementing ... instead of
  shelling out to `sf`" as rejected, for reasons this doc's Problem section explains no longer hold.
  Per Implementation plan step 7, that section should point here once implemented rather than stand
  uncorrected.
