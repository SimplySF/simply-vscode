# 0011 — AT4DX Webview Rewritten in Svelte

**Status:** Draft
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-27

## Problem

The "AT4DX Bindings" webview's entire UI — layout, the SObject/Trigger Event toolbar, section/row
rendering, the issues list, and the create/edit form added in
[0009](0009-at4dx-create-edit-domain-process-bindings.md) — lives as two large template-literal strings
in `domainProcessBindingPanel.ts`: `SHARED_STYLE` (~180 lines of CSS) and `CLIENT_SCRIPT` (~570 lines of
hand-written, dependency-free JS building HTML via string concatenation and manual
`innerHTML`/`addEventListener` wiring). This was a deliberate choice at the time
([0001](0001-at4dx-domain-process-binding-explorer.md)'s Alternatives considered) to keep the webview
free of any build step or bundled dependency, but the form work in 0009 already strained it — nested
conditional markup (`fTriggerOperation` vs. `fDomainMethodToken` visibility), imperative DOM patching for
validation errors, and manual re-render calls (`render()`, `renderForm()`) after every state change are
exactly the bookkeeping a component framework exists to remove. [0010](0010-automated-test-harness.md)
named this directly as a deliberately-deferred follow-up ("Promoting `CLIENT_SCRIPT` to a real,
separately-compiled file", its Alternatives considered and Open questions) and flagged the coverage gap
it causes: `@vitest/coverage-v8` can't attribute anything to `CLIENT_SCRIPT`'s ~570 lines because they
run inside a separately constructed `jsdom` document, not as instrumented code in the test process.

The ask that starts this doc: rebuild the same panel's UI as Svelte components instead of hand-rolled
string templating, so future changes (a new form field, a new row affordance) are ordinary component
edits instead of string-concatenation surgery, and so the webview's logic can be unit-tested like any
other source file instead of extracted from a template literal by marker-string search.

## Decision

Rewrite the webview's presentation layer as **Svelte 5** components under a new `src/webview/` directory,
compiled by **`esbuild-svelte`** into a second esbuild entry point (`dist/webview.js`) alongside the
existing extension-host bundle (`dist/extension.js`). `domainProcessBindingPanel.ts` keeps doing exactly
what it does today at the *host* level — building `BindingSource`-scoped state, handling
`postMessage`s, calling `at4dxCli.ts`'s read/write functions — but no longer contains any HTML/CSS/JS
markup itself. It shrinks to: a minimal HTML shell (a `<div id="app">` mount point, a nonce'd inline
`<script>` embedding the initial state as `window.__INITIAL_STATE__` — reusing `embedJsonInScript`
unchanged — and a `<script>` tag loading `dist/webview.js` via `webview.asWebviewUri()`) plus the same
`onDidReceiveMessage`/`postMessage` handling it has today, unchanged in shape.

This is a pure internal refactor, not a UI change: every field, button, click target, validation rule,
and message shape in [0001](0001-at4dx-domain-process-binding-explorer.md),
[0007](0007-at4dx-validate-viewed-bindings.md), and [0009](0009-at4dx-create-edit-domain-process-bindings.md)
carries over unchanged. It gets its own doc anyway (rather than relying on `docs/design/README.md`'s
"refactors that keep observable behavior identical" exemption) because it *is* the "webview-build-pipeline
change" 0010 explicitly called out as its own follow-up, not a same-doc-worthy tweak: a new build step, a
new bundled dependency, a new file shipping in the `.vsix`, and a different testing approach for the
webview's logic all deserve the reasoning trail this process exists for.

## Behavior

No user-visible change. The panel opens, scans, groups, and validates exactly as
[0001](0001-at4dx-domain-process-binding-explorer.md)/[0007](0007-at4dx-validate-viewed-bindings.md)
describe, and the create/edit form behaves exactly as [0009](0009-at4dx-create-edit-domain-process-bindings.md)
describes — same fields, same client-side validation messages, same `submitBinding`/`writeBlocked`/
`writeError` message contract between host and webview. This section instead documents the new
*internal* shape.

### File layout

```
extensions/simply-at4dx/
  src/
    at4dxCli.ts                  # unchanged
    extension.ts                 # threads context.extensionUri through to the panel (see below)
    logger.ts                    # unchanged
    domainProcessBindingPanel.ts # host logic only — shell HTML, postMessage handling, no markup
    webview/
      main.ts                    # mounts App.svelte against window.__INITIAL_STATE__
      vscodeApi.ts                # thin acquireVsCodeApi() wrapper, passed via Svelte context
      types.ts                   # re-exports the at4dxCli.ts types the webview needs (row/issue/rules shapes)
      App.svelte                 # top-level: which sub-view is showing (loading/error/empty/data/form)
      Toolbar.svelte              # SObject + Trigger Event selects, "+ New Binding" button
      SummaryBar.svelte           # clean / N error(s) · N warning(s) banner, click-to-scroll
      BindingSections.svelte      # groups ALL_ROWS by family into titled sections
      BindingRow.svelte           # one row: icon, name, order, badges, active pill, edit icon
      IssuesSection.svelte        # "In <SObject>" / "Elsewhere in this scan" issue groups
      IssueEntry.svelte           # one issue line, clickable when locally scanned
      BindingForm.svelte          # create/edit form — fields, conditional Trigger Operation/Domain
                                   # Method Token, client-side validation, Save/Save Anyway/Cancel
      Icon.svelte                 # named inline-SVG icon (criteria/action/async/crown/edit)
      tsconfig.json                # extends ../../tsconfig.json, adds "lib": ["ES2022", "DOM"] — see
                                    # Implementation plan
  esbuild.js                     # gains a second esbuild context for the webview entry point
```

### Build

`esbuild.js` builds two contexts in the same `main()` (both under one `--watch`/`--production` run, so
`npm run watch`/`npm run compile` still cover the whole extension with one command):

| Entry point | Output | Platform/format | Notes |
| --- | --- | --- | --- |
| `src/extension.ts` | `dist/extension.js` | `node` / `cjs`, `external: ['vscode']` | Unchanged from today. |
| `src/webview/main.ts` | `dist/webview.js` | `browser` / `iife` | New. Uses the `esbuild-svelte` plugin, `compilerOptions: { css: 'injected' }` (see Alternatives considered) so no separate CSS output file exists — every component's styles ship as part of the one JS bundle, injected as `<style>` elements at mount time the same way Svelte's dev-server output does. |

`dist/webview.js` is not excluded by `.vscodeignore` (only `src/**`, `node_modules/**`, and a handful of
config files are), so it ships in the `.vsix` the same way `dist/extension.js` already does — no
packaging change needed.

### CSP

Unchanged in spirit, adjusted for one more script source: `default-src 'none'; style-src
'unsafe-inline'; script-src 'nonce-${nonce}'`. `style-src 'unsafe-inline'` already covers Svelte's
runtime-injected `<style>` elements — this is exactly why `css: 'injected'` was chosen over
`css: 'external'` (see Alternatives considered). Both `<script>` tags in the shell HTML — the inline
`window.__INITIAL_STATE__` assignment and the `<script src="...">` loading `dist/webview.js` — carry the
same per-render nonce `buildShellHtml` already generates via `getNonce()`.

### Host ↔ webview contract

Unchanged: `window.__INITIAL_STATE__` carries the same shape `buildDataScript` embeds today (`rows`,
`issues`, `rules`, `isLocalScan`), and the webview posts the same `openClass`/`openIssue`/`submitBinding`
messages the host already handles in `onDidReceiveMessage`; the host posts the same `writeBlocked`/
`writeError` messages back. No message shape changes — only *where* the code that sends/receives them
lives.

### Re-render model

Preserved exactly as today: every `PanelState` transition (`loading` → `data`/`error`/`empty`, and back
to `data` after a successful create/edit) replaces `panel.webview.html` wholesale via `buildShellHtml`,
which re-mounts the whole Svelte app fresh with a new `window.__INITIAL_STATE__` — the same full-reload
model `render()` already uses. This doc deliberately does not change that to a postMessage-based partial
update (see Alternatives considered); it's out of scope for a like-for-like rewrite.

### `context.extensionUri` plumbing

`webview.asWebviewUri()` needs the extension's own `vscode.Uri` to build a webview-safe URI to
`dist/webview.js`, which the panel doesn't hold today. `extension.ts`'s `activate(context)` already has
`context.extensionUri`; `showDomainProcessBindings` and `DomainProcessBindingPanel.open`/the panel's
constructor gain one new parameter to carry it through — the same kind of one-parameter threading 0009
already did for `workspaceFolder`/`target`/`logger`.

## Alternatives considered

**`css: 'external'`** (Svelte/`esbuild-svelte`'s other CSS mode), producing a separate `dist/webview.css`
linked via a `<link>` tag. This is arguably the more conventional Svelte build output, and avoids paying
the (small, one-time-per-mount) cost of injecting `<style>` tags via JS. Rejected for the added CSP
surface it needs: an external stylesheet isn't covered by `style-src 'unsafe-inline'` (that directive
only covers inline `<style>`/`style="…"`, not linked files), so it would need `style-src
${webview.cspSource}` added just to load one file. `css: 'injected'` keeps the CSP line identical to
today's and keeps the packaged output to the one new file (`dist/webview.js`) instead of two.

**A separate npm workspace / Vite build for the webview**, matching how many VS Code extension
starter templates split "extension host" and "webview UI" into two `package.json`s. Rejected: this repo
has one extension with real source (`simply-at4dx`) and one esbuild-based build already
([0010](0010-automated-test-harness.md)'s Alternatives considered made the same call about `wireit` for
the same reason — no interdependency complex enough to need it). A second esbuild context in the same
`esbuild.js`, same `package.json`, same `npm run compile`/`watch` scripts, is enough; a second workspace
package would add a directory, a second `node_modules`, and a second release-tooling surface for no
capability this doc needs.

**Keeping `CLIENT_SCRIPT` as hand-written JS but splitting it into multiple template-literal strings**
(one per "section" of the UI), as a smaller step short of a real framework. Rejected: this doesn't solve
the actual pain points — manual `innerHTML` diffing, no component-local state, and (per 0010) no route to
real test coverage or type-checking. It would be strictly more files carrying the same fundamental
approach.

**React or another component framework**, instead of Svelte. The user's ask named Svelte specifically;
no framework-comparison alternatives are recorded here since the choice was given, not derived. Worth
noting for future readers: Svelte's compiled output has no runtime framework bundled into every
component tree (unlike React, which would add React itself, `react-dom`, and — for anything resembling
today's reactivity — a state library, to the `.vsix`'s `dist/webview.js`), which happens to fit this
project's existing "small, dependency-light bundle" instinct
([0001](0001-at4dx-domain-process-binding-explorer.md)'s codicons rejection, 0010's Vitest-over-Jest
reasoning) better than a heavier alternative would have, even though that wasn't the deciding factor.

**Changing the re-render model to targeted `postMessage` updates instead of a full
`panel.webview.html` replace per state change**, now that the webview is a real component tree that could
receive a "here's new state" message and reactively update instead of remounting. A genuinely better
long-term shape (no full webview reload — and no re-run of the create/edit form's mount, though 0009
already established the form survives host-driven re-renders by staying entirely client-side) — but it's
a *behavior*-adjacent change to when/how the DOM updates, not just an implementation swap, and bundling it
into a "rewrite the same UI in Svelte" doc would make the actual ask (component-based, testable webview
code) wait on a second design decision it doesn't need. Tracked in Open questions.

## Implementation plan

1. **`extensions/simply-at4dx/package.json`** — add `devDependencies`: `svelte` (`^5`), `esbuild-svelte`,
   `svelte-check`, `@testing-library/svelte`. `jsdom` is already a `devDependency` (0010) and is reused
   for component tests.
2. **`esbuild.js`** — add the `src/webview/main.ts` → `dist/webview.js` context described in Behavior,
   using `esbuild-svelte` with `compilerOptions: { css: 'injected' }`; both contexts built/watched
   together in `main()`.
3. **`src/webview/types.ts`** — re-export the row/issue/rules/form-payload types the webview needs from
   `at4dxCli.ts`/`domainProcessBindingPanel.ts` (type-only imports; no runtime dependency on Node-only
   code).
4. **`src/webview/Icon.svelte`, `SummaryBar.svelte`, `Toolbar.svelte`, `BindingRow.svelte`,
   `BindingSections.svelte`, `IssueEntry.svelte`, `IssuesSection.svelte`** — port `CLIENT_SCRIPT`'s
   `rowHtml`/`sectionHtml`/`buildSections`/`issueEntryHtml`/`issuesSectionHtml`/`summaryHtml` and
   `SHARED_STYLE`'s corresponding rules into components with scoped `<style>` blocks, field-for-field.
5. **`src/webview/BindingForm.svelte`** — port `renderForm` and its validation/submit logic
   (`developerNameValid`, the required-field checks, the Process Context show/hide, the
   `writeBlocked`/`writeError` message handling) from `CLIENT_SCRIPT`, field-for-field against 0009's Form
   fields table.
6. **`src/webview/App.svelte`, `main.ts`, `vscodeApi.ts`** — top-level view-state (data/form, mirroring
   0009's "form is entirely client-side" implementation note), reading `window.__INITIAL_STATE__`,
   providing the `acquireVsCodeApi()` handle via Svelte context.
7. **`src/webview/tsconfig.json`** — `{ "extends": "../../tsconfig.json", "compilerOptions": { "lib":
   ["ES2022", "DOM"] }, "include": ["./**/*.ts", "./**/*.svelte"] }`; excluded from the root `tsconfig.json`'s
   `include` (`src/**` stays DOM-free for the host code, matching 0010's reasoning for keeping `src/`
   DOM-free everywhere except this one subtree that generally runs in a browser context).
8. **`domainProcessBindingPanel.ts`** — delete `SHARED_STYLE`, `CLIENT_SCRIPT`, `buildDropdownsHtml`,
   `buildInitialContentHtml`; rewrite `buildShellHtml`/`buildDataScript` to the minimal shell described in
   Behavior; thread `extensionUri` through `open()`/the constructor for `asWebviewUri()`.
9. **`extension.ts`** — pass `context.extensionUri` into `showDomainProcessBindings` →
   `DomainProcessBindingPanel.open`.
10. **Tests** — delete `test/support/extractClientScript.ts` and
    `test/domainProcessBindingClientScript.test.ts`; add `test/webview/*.test.ts` per component using
    `@testing-library/svelte`, porting 0009/0010's existing check list (initial render and grouping,
    create-form prefill from toolbar selection, required-field validation, the exact `submitBinding`
    payload shape, `writeBlocked` → "Save Anyway" → `force: true` resubmit, `writeError` rendering,
    Cancel, and the edit-icon's event not also firing the row's open-class click).
11. **`vitest.config.mts`** — no environment change needed at the top level (`environment: 'node'` stays
    the default); component test files opt into `// @vitest-environment jsdom` the same way the file
    being replaced already did.
12. **`README.md`** — no user-facing content changes; note in a short "Development" aside (if one doesn't
    exist yet) that the webview is a separate Svelte bundle built alongside the extension host.
13. **Manual verification** in a real Extension Development Host: every flow 0001/0007/0009 already
    describe, run once against the rewritten panel to confirm pixel/behavior parity — this doc adds no new
    flows to check, only a new implementation of the existing ones.
14. **This doc's Status** → `Implemented` (with the PR link) once the above lands, `npm run compile` and
    `npm test` are green, and the manual check passes.

## Testing

**Automated:** `svelte-check` (new) type-checks the `.svelte` files the way `tsc --noEmit` already does
for `.ts`; wire it into `npm run compile` alongside the existing `esbuild.js --production && tsc
--noEmit -p .` line. Component tests (`@testing-library/svelte` + Vitest, `jsdom` environment) replace
`domainProcessBindingClientScript.test.ts`'s jsdom-extraction approach with real, individually-attributable
test files per component — the same underlying behavior 0009/0010 already verified, now covered by
`@vitest/coverage-v8` the way the old `CLIENT_SCRIPT` string never could be (0010's Open questions).

**Manual:** the Implementation plan's step 13 — the existing 0001/0007/0009 flows, run once against the
new build, since this doc's whole premise is "identical behavior, different implementation" and nothing
short of clicking through it in a real webview confirms that held.

## Open questions

- **Targeted `postMessage` state updates instead of a full webview reload per state change** — deferred,
  see Alternatives considered. Worth its own follow-up once there's a concrete reason (e.g. reload
  flicker becoming a real complaint, or wanting to preserve scroll position across a re-scan).
- **`svelte-check` in CI** — this doc adds it to `npm run compile` locally; confirm it's fast enough
  (no VS Code download, so it should be, but not yet measured) to not need special CI handling beyond
  what `.github/workflows/ci.yml`'s existing `compile` step already runs.
- **Svelte 5 minimum VS Code Electron/Chromium compatibility** — `esbuild-svelte`'s browser-target output
  needs to run inside whatever Chromium version ships with the `engines.vscode` floor
  (`^1.119.0`, per `package.json`). Not expected to be a real constraint (Svelte 5's compiled output
  targets evergreen browsers, and VS Code's webview Chromium tracks recent Electron closely), but not
  independently verified against that specific floor version.
- **Manual Extension Development Host smoke test** — not run as part of this change (no GUI available in
  the environment that implemented it). This is what's blocking this doc's Status; see Implementation
  plan step 13. Everything else (`npm run compile` — esbuild for both bundles, `tsc --noEmit`,
  `svelte-check` — and `npm test`, 78 tests across 8 files) is green.

## Implementation notes (post-implementation)

A few places where implementing this taught something the design above didn't anticipate:

- **Component tests need `vite` + `@sveltejs/vite-plugin-svelte` too, not just `esbuild-svelte`.** The
  Implementation plan's package.json step didn't call this out. Vitest's own module transform pipeline is
  Vite-based regardless of what bundles the shipped extension (`esbuild-svelte` still owns the real
  `dist/webview.js`, per the Decision above) — without the Vite plugin, `test/webview/*.test.ts` can't
  import a `.svelte` file at all. Both landed as new `devDependencies`.
- **`@testing-library/svelte`'s `render()` needs `resolve.conditions: ['browser']` in `vitest.config.mts`,
  or every component test throws `lifecycle_function_unavailable` (\`mount(...)\` is not available on the
  server).** Without it, Vite/Vitest resolves Svelte's server (SSR) runtime for `.svelte` imports instead
  of the client one — this is the documented fix from Svelte's own component-testing guide, not specific
  to this repo. Scoped as a top-level `resolve.conditions` rather than per-file since it didn't break any
  existing Node-environment test when added globally (verified by running the full suite after the
  change) — `@salesforce/core` and friends resolve the same either way.
- **`src/webview/tsconfig.json` needed an explicit `"exclude": []`.** The root `tsconfig.json`'s
  `"exclude": ["src/webview"]` (added so `tsc`'s own `src` program stays DOM-free — see Behavior) is
  inherited by any config that `extends` it; TypeScript resolves an inherited `exclude` path relative to
  the *child* config's directory, so unset it re-excluded `src/webview` from itself. Also needed
  `"module": "ESNext"` alongside `"moduleResolution": "Bundler"` — the root config's `"module": "Node16"`
  is incompatible with `Bundler` resolution.
- **The form's per-field error `<span>`s gained explicit `id="fXError"` attributes**, matching the old
  `CLIENT_SCRIPT`'s `id="${id}Error"` convention — not called out in the plan, since Svelte's reactivity
  needs no `id` to update that text. Added anyway (and worth keeping) for the same reason the original
  had them: a stable, queryable hook for both tests and any future `aria-describedby` wiring.
- **`untrack` (from `'svelte'`) wraps the one-time prop reads that seed each mount's local `$state`** —
  `App.svelte`'s `initial`, `BindingForm.svelte`'s `mode`/`initial`. Without it, Svelte's compiler warns
  `state_referenced_locally` on every such read, since it can't otherwise distinguish "seed local state
  once from a prop this specific architecture guarantees is static for the component's lifetime" (true
  here specifically *because* of the "re-render model" decision above — a new `BindingForm`/`App` mounts
  fresh on every state change, never receiving updated props in place) from an accidental one-time read of
  something meant to stay reactive. `svelte-check` went from 29 warnings to 0 after this change.
- **`test/tsconfig.json` (the editor-only config covering the whole `test/` tree, not run by any npm
  script) flags a `TS1479` on the three new `test/webview/*.test.ts` files' `@testing-library/svelte`
  import** — this repo's CJS default (no `"type": "module"` in `package.json`, matching `esbuild.js`'s
  `format: 'cjs'` extension-host output) makes a plain `tsc` program see importing that ESM-only package
  as a `require()` of an ES module. Harmless in practice: `npm test`/`npm run compile` are unaffected
  (Vitest's own transform is ESM/CJS-interop-aware regardless of `tsconfig.json`'s `module` setting, and
  the root `tsc --noEmit -p .` gate doesn't include `test/` at all), so this is an editor-IntelliSense-only
  false flag on an already-unenforced config, not a new gap in the automated checks — left as-is rather
  than changing the extension's module system as a side effect of this doc.
