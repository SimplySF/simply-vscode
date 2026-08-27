# 0010 — Automated Test Harness

**Status:** Draft
**Extension:** repo-wide tooling — `extensions/simply-at4dx` is the only extension with source today, so
it's where this first lands, but nothing here is AT4DX-specific (see Decision for why this doc isn't
titled `AT4DX ...` like every doc before it)
**Date:** 2026-08-27

## Problem

Nothing in this repo is automatically tested. `.github/workflows/ci.yml` runs `npm run compile`
(`esbuild` + `tsc --noEmit`) on every push, which catches type errors and bundling failures but proves
nothing about runtime behavior — every one of `simply-at4dx`'s eight design docs so far has had to fall
back on "F5 into the Extension Development Host and click through it by hand" as its Testing section,
and most ([0001](0001-at4dx-domain-process-binding-explorer.md),
[0006](0006-at4dx-direct-library-imports.md), [0009](0009-at4dx-create-edit-domain-process-bindings.md))
explicitly flag "no automated test harness yet" as a standing open question. [0009](0009-at4dx-create-edit-domain-process-bindings.md)'s
own verification — extracting the webview's `CLIENT_SCRIPT` string out of `domainProcessBindingPanel.ts`
by hand with a throwaway Node script, `new Function`-evaluating it, and driving it against a manually
built `jsdom` document — worked, and worked well enough to catch a real bug (a missing required-field
check for Trigger Operation) before merge, but it isn't checked in, isn't run in CI, and would have to be
re-invented from scratch for the next change. That's the concrete gap this doc closes: turn that ad hoc,
one-off verification into something that lives in the repo, runs on every push, and grows with the
codebase instead of being thrown away after each PR.

## Decision

Two tiers, matching the actual shape of the code rather than one framework stretched to cover both:

**Unit tests — [Vitest](https://vitest.dev/)**, running in plain Node against `extensions/simply-at4dx`'s
source files directly (no VS Code involved). This is the tier this doc actually implements. Vitest isn't
a new choice for this codebase's toolchain: `@simplysf/simply-aep-core` — a direct dependency of this
extension, imported by `at4dxCli.ts` — is tested with Vitest + `sinon` in its own repo (`simply-node`),
using `@salesforce/core/testSetup`'s `TestContext`/`MockTestOrgData` to fake org auth rather than hand-
rolling `AuthInfo`/`Connection` stubs. `at4dxCli.ts` calls those exact same `AuthInfo`/`Connection` APIs
(`resolveConnection`, used by the read path and both write functions), so the identical mocking approach
applies here directly — there's no reason to solve "how do you fake a Salesforce org connection in a
test" a second, different way in the same dependency chain. See Behavior for the concrete
file/tooling layout, mirrored from `simply-aep-core`'s `test/` convention.

What's actually testable this way turns out to be almost everything with real logic in it:

- `at4dxCli.ts` in full — `getDomainProcessBindings`, `createBinding`, `setBinding`, target resolution,
  and error-code-to-message translation — by mocking `@simplysf/simply-aep-core`'s scan/write functions
  (see Open questions for the one thing to confirm about mocking a dynamic `import()`) and faking org
  auth via `@salesforce/core/testSetup`.
- `logger.ts`'s pure functions (`truncate`, `redactProxyUrl`).
- `extension.ts`'s `resolveDefaultSourceDir` — filesystem-based, no `vscode.window`/`vscode.workspace`
  interaction beyond the `WorkspaceFolder` value passed in, straightforward to test against a temp
  directory and a mocked `SfProject.resolve`.
- The webview's `CLIENT_SCRIPT` — everything [0009](0009-at4dx-create-edit-domain-process-bindings.md)'s
  ad hoc `jsdom` verification already proved out: form open/prefill, client-side validation, the exact
  `submitBinding` payload shape, the blocked/error message handling, Cancel, and the edit icon's
  `stopPropagation`. This is the one item that needs a small, purpose-built test helper rather than a
  plain `import` — see Behavior.

What's *not* covered by this tier, because it's not logic — it's real VS Code API surface with no
meaningful behavior to assert on outside a real Extension Host: `vscode.commands.registerCommand`
actually registering on activation, `vscode.window.createWebviewPanel` actually creating a panel and the
generated HTML actually loading under the real webview CSP, and the `vscode.window.showQuickPick` chains
in `pickWorkspaceFolder`/`pickBindingSource`. Automating that needs `@vscode/test-cli` +
`@vscode/test-electron` — a real, if small, VS Code download running inside an actual (headless-via-
`xvfb` on Linux CI) Extension Development Host. This doc deliberately does not build that tier: it's a
different, heavier piece of tooling (a second npm script, a second CI job, a documented approach to the
"how do you script picking a QuickPick item" problem that every VS Code extension test suite has to
answer one way or another), and the unit tier above already covers the overwhelming majority of this
extension's actual bug surface — including the one bug 0009's manual verification actually caught. Worth
its own follow-up doc once there's a concrete reason to reach for it (e.g. a bug that specifically lived
in the QuickPick/activation glue, not the logic underneath it) rather than building it speculatively now.
See Open questions.

## Behavior

### File layout

Mirrors `simply-aep-core`'s own convention exactly — a sibling `test/` directory, not colocated
`*.test.ts` files, so `src/` stays exactly what ships in the bundle:

```
extensions/simply-at4dx/
  src/
    at4dxCli.ts
    domainProcessBindingPanel.ts
    extension.ts
    logger.ts
  test/
    tsconfig.json                        # extends ../tsconfig.json, includes ./**/*.ts
    at4dxCli.test.ts
    logger.test.ts
    extension.test.ts                    # resolveDefaultSourceDir only — see Decision
    support/
      extractClientScript.ts             # see "Testing the webview script" below
    domainProcessBindingClientScript.test.ts
  vitest.config.ts
```

### npm scripts

Added to `extensions/simply-at4dx/package.json` (test tooling is per-extension, like `esbuild`/
`typescript` already are — see Alternatives considered for why this isn't root-shared the way `vsce`/
`semantic-release` are):

| Script | Command | Purpose |
| --- | --- | --- |
| `test` | `vitest run` | One-shot run, what CI calls. |
| `test:watch` | `vitest watch` | Local dev loop. |
| `test:coverage` | `vitest run --coverage` | `@vitest/coverage-v8`, matching `simply-aep-core`'s own script naming. |

`npm run compile` is unchanged — it stays the type-check/bundle gate; `npm test` is a separate, new gate.

### CI wiring

`.github/workflows/ci.yml`'s `compile` job gains a step after the existing `npm run compile -w
extensions/simply-at4dx` line:

```yaml
- run: npm run test -w extensions/simply-at4dx
```

Same job, same runner, no new workflow file — this is a fast (`node`-only, no VS Code download) step,
so there's no reason to split it into its own job or gate it differently than the compile check it sits
next to.

### Testing the webview script

`CLIENT_SCRIPT` in `domainProcessBindingPanel.ts` is a template-literal string of plain JS, injected
verbatim into the generated webview HTML — deliberately not compiled or bundled (see 0001's Alternatives
considered on why the webview stays dependency-free inline markup/script, for the packaging reasons that
still apply). Rather than promoting it to a real, separately-compiled `.ts` file — a genuine option, but
a webview-build-pipeline change, not a testing change (see Alternatives considered) — this doc adds one
small, well-behaved test helper:

```ts
// test/support/extractClientScript.ts
export function extractClientScript(): string {
  const source = fs.readFileSync(path.join(__dirname, '../../src/domainProcessBindingPanel.ts'), 'utf8');
  const marker = 'const CLIENT_SCRIPT = `';
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error('extractClientScript: CLIENT_SCRIPT marker not found — did domainProcessBindingPanel.ts change shape?');
  }
  const bodyStart = start + marker.length;
  const end = source.indexOf('`;', bodyStart);
  if (end === -1) {
    throw new Error('extractClientScript: could not find the closing `;` for CLIENT_SCRIPT.');
  }
  return source.slice(bodyStart, end);
}
```

`domainProcessBindingClientScript.test.ts` calls this once, evaluates the result in a `jsdom` document
built to match `buildShellHtml`'s real output shape (toolbar + `#content` + a stubbed
`acquireVsCodeApi`), and asserts against the DOM exactly the way 0009's throwaway verification script
did — that script's checks (initial render, create-form prefill, required-field validation, the submitted
payload shape, the blocked/error message flow, Cancel, edit-icon `stopPropagation`) become this file's
test cases essentially unchanged, just formalized as `it(...)` blocks instead of hand-rolled `assert`
calls. The explicit, actionable errors on a missing/moved marker mean this stays a "the test tells you
exactly what broke" failure, not a silent no-op, if `domainProcessBindingPanel.ts`'s shape ever changes
enough to break the extraction. `jsdom` becomes a new `devDependency` (`extensions/simply-at4dx/
package.json`, test-only) — the same package this doc's Problem section's throwaway verification already
proved works for this exact purpose.

## Alternatives considered

**Jest**, the most common choice for this kind of project generally. Rejected: no reason to diverge from
`simply-aep-core`'s Vitest choice, and Vitest's native ESM/TypeScript handling (no separate `ts-jest`/
Babel transform config to maintain) fits this repo's existing `"module": "Node16"` + dynamic-`import()`-
for-ESM-only-deps pattern more directly than Jest's CommonJS-first defaults would.

**Mocha**, matching what `@vscode/test-cli` itself defaults to for the *integration* tier this doc
doesn't build yet. Considered specifically for "one framework for both tiers" consistency. Rejected for
now: this doc only builds the unit tier, where Vitest's advantages (native TS/ESM, built-in mocking,
watch mode, `@vitest/coverage-v8`) apply directly and Mocha brings no offsetting benefit since there's no
second tier yet to share a framework with. Revisit if/when the integration tier (see Decision) gets built
— it may end up genuinely two different frameworks for two genuinely different jobs, the same way this
doc's own Decision already argues one tool doesn't have to cover both.

**Node's built-in `node:test`**, avoiding any new dependency. Rejected: this repo already has a working,
proven-elsewhere-in-the-same-dependency-chain answer (`simply-aep-core`'s Vitest setup) to "how do you
test TypeScript importing an ESM-only package under a `module: Node16` project" — reinventing that with a
different, unproven-here tool for the sake of one fewer dependency isn't worth losing the direct
precedent to copy from, especially for the `AuthInfo`/`Connection` mocking approach specifically.

**`vitest`/`@vitest/coverage-v8` as root-level shared `devDependencies`**, the way `@vscode/vsce`/
`semantic-release` already are per `RELEASING.md`. Rejected: `RELEASING.md`'s existing rule is specifically
about *release/publish* tooling, which is genuinely identical and shared across every extension via the
`release.yml` build matrix. Test tooling is closer in kind to `esbuild`/`typescript`/`@types/vscode` —
already per-extension `devDependencies` today, since each extension has its own build config and, in
principle, could need a different version. `test/tsconfig.json extends ../tsconfig.json` the same way
`simply-aep-core`'s does, for the same reason: one extension's compiler settings shouldn't have to be
identical to another's just because both happen to use Vitest.

**Wireit**, matching `simply-aep-core`'s build-orchestration/caching tool, for consistency. Rejected for
now: `wireit` earns its keep in a monorepo with many packages and expensive, interdependent build steps —
`simply-node` is exactly that. `simply-vscode` has one extension with real source today and no
interdependency between build steps beyond "compile, then test" — plain `npm run` scripts do that with no
added tooling. Revisit if a second extension gaining tests, or a genuinely expensive build step, makes the
caching worth the added complexity.

**Promoting `CLIENT_SCRIPT` to a real, separately-compiled `.ts` file** (e.g. `src/webview/
clientScript.ts`, typed against `lib: ["DOM"]`, bundled by `esbuild` and its output text inlined into the
generated HTML at build time), instead of the string-extraction test helper. This is the more *correct*
long-term shape — real type-checking for code that currently has none, no reliance on a marker string
staying put, and no need for a test-only extraction step at all. It's also a real webview-build-pipeline
change (a second `tsconfig.json` scoped to DOM types, a build step that produces a string constant from
compiled output rather than source text, verifying the extra build step doesn't regress the "single
self-contained `dist/extension.js`" packaging property [0001](0001-at4dx-domain-process-binding-explorer.md)
deliberately chose) — meaningfully more scope than "add a test harness," and coupling it to this doc would
make the actual ask (get *some* automated coverage running in CI) wait on a decision that doesn't need to
block it. Tracked as a follow-up in Open questions rather than silently dropped.

## Implementation plan

1. **Spike: confirm `vi.mock('@simplysf/simply-aep-core', ...)` actually intercepts `at4dxCli.ts`'s
   dynamic `await import('@simplysf/simply-aep-core')` calls.** Vitest's mocking operates at module-
   resolution time (same mechanism Vite's dev server uses to serve transformed modules), which should
   cover dynamic `import()` the same as a static one, but this repo has a habit of spiking exactly this
   kind of "does the interop actually work" question before committing to an approach (0005, 0006) rather
   than assuming — do the same here before writing real test files against the assumption.
2. **`extensions/simply-at4dx/package.json`** — add `vitest`, `@vitest/coverage-v8`, `jsdom`, `sinon`,
   `@types/sinon` as `devDependencies`; add the three scripts from Behavior above.
3. **`extensions/simply-at4dx/vitest.config.ts`** — `environment: 'node'` by default (most of this
   tier doesn't need a DOM), `include: ['test/**/*.test.ts']`, coverage provider `v8` scoped to
   `src/**/*.ts`. `domainProcessBindingClientScript.test.ts` opts into `// @vitest-environment jsdom` at
   the top of that one file rather than making the whole project pay for a DOM environment.
4. **`extensions/simply-at4dx/test/tsconfig.json`** — `{ "extends": "../tsconfig.json", "include":
   ["./**/*.ts"] }`, matching `simply-aep-core`'s.
5. **`test/at4dxCli.test.ts`** — `getDomainProcessBindings`/`createBinding`/`setBinding` against a
   mocked `@simplysf/simply-aep-core` (per step 1's spike) and `@salesforce/core/testSetup`'s
   `TestContext`/`MockTestOrgData` for the org-connection path; every `At4dxCliError` message this file
   produces (local scan failed, org query failed, connection failed, `at4dxNotDetected`, each
   `DomainProcessBindingWriteErrorCode` translation including the `deploy-failed` special case); the
   `{ kind: 'blocked' }` outcome path.
6. **`test/logger.test.ts`** — `truncate`, `redactProxyUrl`.
7. **`test/extension.test.ts`** — `resolveDefaultSourceDir`'s three-step fallback (package-directory hit,
   `sfdx-source`/`force-app` fallback, workspace-root fallback), against a temp directory and a mocked
   `SfProject.resolve`.
8. **`test/support/extractClientScript.ts`** and **`test/domainProcessBindingClientScript.test.ts`** —
   per Behavior above; port 0009's manual verification checks in as real `it(...)` cases.
9. **`.gitignore`** — add `coverage/`.
10. **`.github/workflows/ci.yml`** — add the `npm run test -w extensions/simply-at4dx` step.
11. **`RELEASING.md`**'s "Adding a new extension" checklist — add a step: set up `test/`, `vitest.config.ts`,
    and the three npm scripts per this doc, and add the extension to `ci.yml`'s test step, the same way
    steps 2–4 already cover the debug-configuration and release-matrix wiring.
12. **This doc's Status** → `Implemented` (with the PR link) once the above lands and CI is green on a
    real push.

## Testing

The tests this doc adds *are* the testing story — there's no meta-layer beyond confirming `npm test`
(and the CI step that calls it) actually fails on a broken build and passes on a working one. Manual
check: temporarily break something real in `at4dxCli.ts` (e.g. swap an error-message string), confirm
the corresponding test fails with a clear diff, revert, confirm green again.

## Open questions

- **`@vscode/test-cli`/`@vscode/test-electron` integration tier** — deliberately not built here (see
  Decision). Worth its own doc once there's a concrete reason to reach for it; that doc would also need
  to answer the "how do you script picking a QuickPick item" question this repo hasn't had to answer yet
  (dependency-injecting the picker, driving the real UI via keyboard simulation, or restructuring
  `pickWorkspaceFolder`/`pickBindingSource` so the decision logic is testable independent of the QuickPick
  UI itself).
- **Promoting `CLIENT_SCRIPT` to a real, typed, separately-built file** instead of the string-extraction
  test helper — see Alternatives considered. The right move eventually; deliberately out of scope here so
  this doc's actual ask isn't blocked on a webview-build-pipeline redesign.
- **No linting anywhere in this repo yet** (no ESLint config exists, despite `simply-extension-pack`
  recommending `dbaeumer.vscode-eslint` to *users*). Noticed while researching this doc, not something it
  addresses — a separate concern from automated tests, and not something to bundle in as a side effect.
- **`simply-extension-pack` has no source and nothing to test** — this doc's file layout/CI wiring is
  written so a future extension that does have source can copy it directly (see the `RELEASING.md`
  checklist addition), not so `simply-extension-pack` specifically needs anything today.
