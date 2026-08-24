# 0001 — AT4DX Domain Process Binding Explorer

**Status:** Draft
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-24

## Problem

AT4DX's Trigger Action Framework wires an SObject's trigger events (or a domain method's "process
token") to ordered criteria/action Apex classes through `DomainProcessBinding__mdt`. Today, answering
"what runs, in what order, when `Account` fires `Before_Insert`, and is it active?" means opening
Setup and reading Custom Metadata records one at a time — there's no visual, at-a-glance view of a
per-SObject trigger action pipeline the way Salesforce's own Flow Trigger Explorer gives you for
Flow-based automation.

The ask that started this: a per-SObject view showing Before/After Save sections, each binding's
execution order, active/inactive state, and whether it's a criteria or an action — modeled on a
mockup of exactly that layout (`basicview.png` at the `simply-vscode` repo root).

Nothing in this repo could produce that view: `extensions/simply-extension-pack` is a packaging-only
extension pack with no source of its own, and no extension here talked to Salesforce metadata at all
before this.

## Decision

Build `extensions/simply-at4dx`, a VS Code extension whose one command,
**AT4DX: Show Domain Process Bindings**, walks the user through a Command Palette QuickPick flow
(workspace folder → local source or connected org → SObject → trigger event) and renders the result
in a themed webview panel grouped and ordered like the mockup.

The extension does not read or parse Salesforce metadata itself. It shells out to
`sf simply aep at4dx domain-process-binding list --json` — a new command built in the companion
`simply` CLI repo specifically as this extension's data layer (see
[SimplySF/simply-node's docs/design/0008-at4dx-domain-process-binding-list.md](https://github.com/SimplySF/simply-node/blob/main/docs/design/0008-at4dx-domain-process-binding-list.md),
which documents the CMDT scan/resolve logic, and its sibling
[0007-at4dx-binding-list.md](https://github.com/SimplySF/simply-node/blob/main/docs/design/0007-at4dx-binding-list.md)
for the Application Factory binding command that came first). Keeping the metadata-reading logic in
`simply-aep` — not duplicated here — means both the CLI and this extension stay correct against the
same, single implementation of AT4DX's resolution rules; this extension's only job is presentation.

## Behavior

### Command flow

```
AT4DX: Show Domain Process Bindings
  → pick workspace folder        (skipped if only one is open)
  → pick data source              Local Source | <org alias/username>, ...
  → pick SObject                  (skipped if only one has bindings)
  → pick trigger event            Created | Updated | Deleted | Undeleted | Domain Method Execution
  → webview panel opens/updates
```

`sf org list --json` populates the org choices; if it fails (e.g. `sf` not fully configured), the
user can still pick Local Source. The bindings query itself always runs through
`sf simply aep at4dx domain-process-binding list --json`, invoked via `child_process.execFile` with
array arguments — never a shell string — so org usernames or SObject names can't be interpreted as
shell syntax.

### Panel layout

- Header card: "When a(n) **{SObject}** record is **{Created|Updated|Deleted|Undeleted}**" (or,
  for Domain Method Execution, "...domain method **executes**").
- One section per side of the trigger event that actually has bindings — "Record Before Save" /
  "Record After Save" for Insert/Update, "Record Before Delete" / "Record After Delete" for Delete,
  a single "Record After Undelete" for Undelete (Salesforce has no before-undelete trigger context,
  so there's no corresponding empty section). Domain Method Execution instead gets one section per
  distinct `domainMethodToken`.
- Each row: a Criteria vs. Action icon, a `»` marker when the binding runs asynchronously, its
  developer name, `Order: N`, an Active/Inactive pill, and an "⚠ order collision" marker when the CLI
  flagged `orderCollision: true` (two active bindings that AT4DX's own runtime map would silently
  let one of them clobber — see the 0008 doc linked above for why that's a real, not cosmetic, hazard).
- Clicking a row opens that binding's `classToInject` Apex class file, if it's found in the
  workspace.

### Errors

`at4dxCli.ts` translates failures into messages safe to show directly: `sf` missing from `PATH`,
`simply-aep` not installed (with the `sf plugins install @simplysf/simply-aep` fix), the CLI's own
`error.at4dxNotDetected`/`error.*Failed` messages passed through verbatim, and unparseable/non-zero
`--json` output.

## Alternatives considered

**Reimplementing the CMDT scan/resolve logic directly in the extension, instead of shelling out to
`sf`.** Rejected: it would duplicate AT4DX's resolution rules (see 0008) in two languages/repos that
would drift apart, for a command that already exists and already has unit test coverage. The
trade-off accepted instead: this extension requires the Salesforce CLI and `simply-aep` installed,
and a shell-out has more latency and failure modes (CLI not found, plugin not installed) than an
in-process call — judged worth it for a single source of truth.

**A persistent sidebar tree view instead of an on-demand Command Palette + webview.** Rejected for
v1: there's no cheap incremental data source yet (every refresh is a full `sf` process spawn), so a
tree view that auto-refreshes on file save or selection change would either be slow or stale. An
explicit "run the command, pick your scope, get a snapshot" flow matches what the data source can
actually support today. A tree view is a reasonable follow-up once/if scanning gets cheaper (e.g. a
long-lived `sf` process, or reading metadata XML directly for the local-source case).

**VS Code Codicons (`@vscode/codicons`) for the row icons**, matching how many first-party-style
extensions get their iconography. Rejected: this repo's `.releaserc.json` convention packages with
`vsce package --no-dependencies` (see `RELEASING.md`), which skips bundling `node_modules` into the
`.vsix` entirely. `esbuild` inlines JS/TS into `dist/extension.js`, but codicons' font/CSS files are
static assets esbuild never touches — they'd silently vanish from the shipped package under that flag.
Inline SVGs embedded directly in the generated HTML sidestep the packaging pitfall entirely, at the
cost of a few more lines of markup versus a one-line icon-font reference.

**Wiring `simply-at4dx` into `.github/workflows/release.yml`'s `matrix.extension` in the same change
that first built it, before a manual Extension Development Host smoke test had been run.** This was a
deliberate call, made explicitly rather than defaulted into: the repo's own `RELEASING.md` documents
this as a standard step of "Adding a new extension," and doing it now means the extension is a normal
citizen of the existing release flow from the start rather than a special case someone has to
remember to wire in later. The trade-off: the next `main` push carrying a releasable commit under
`extensions/simply-at4dx/**` auto-publishes to the public Marketplace, whether or not the manual
smoke test (see Open questions) has happened by then.

## Implementation plan

Everything below was written in the same pass that produced this doc; it's recorded here in the
order it would be built from scratch, with status against what's actually in the repo today.

1. **`package.json`, `tsconfig.json`, `esbuild.js`, `.vscodeignore`, `.releaserc.json`** — done.
   Standard esbuild-bundled TypeScript extension; `.releaserc.json` mirrors
   `simply-extension-pack`'s, `tagFormat` and filenames swapped to `simply-at4dx`.
2. **`src/at4dxCli.ts`** — done. `getDomainProcessBindings(cwd, target, sobjects?)` shells out and
   parses the `--json` envelope. `DomainProcessBindingRow` and its supporting types are a type-only
   mirror of `@simplysf/simply-aep`'s shape, not an npm dependency on it — this extension only ever
   consumes the CLI's JSON output, never its code, so there's nothing to import. This mirror has to
   be kept in sync by hand when the CLI's row shape changes (see Open questions).
3. **`src/domainProcessBindingPanel.ts`** — done. Builds the webview HTML (inline CSS using
   `--vscode-*` theme tokens so it matches the user's light/dark theme, inline SVG icons, a
   nonce-scoped CSP), and handles the "open class" postMessage from a row click.
4. **`src/extension.ts`** — done. `activate()` registers the command; the QuickPick chain described
   in Behavior above.
5. **`.vscode/launch.json`** — done. Added a "Simply AT4DX" `extensionHost` debug configuration,
   per `RELEASING.md`'s "Adding a new extension" checklist.
6. **`.github/workflows/release.yml`**`matrix.extension` — done. `simply-at4dx` added alongside
   `simply-extension-pack`.
7. **`images/Simply_Logo.png`** — done, reusing `simply-extension-pack`'s icon as-is (not resized
   or re-compressed — see Open questions).
8. **`README.md`, `CHANGELOG.md`** — done.
9. **`.gitignore`** — done. Added `extensions/*/dist/` and `*.tsbuildinfo` so build output from step
   1's esbuild/tsc setup doesn't get committed.
10. **Manual verification in a real Extension Development Host** — not done. See Testing/Open
    questions.
11. **Automated tests for the extension itself** — not done. See Testing/Open questions.

## Testing

**Done:** `npm run compile` (esbuild bundle + `tsc --noEmit`, `strict: true`) passes with no errors
or warnings. This proves the extension type-checks and bundles, not that the QuickPick flow or
webview actually behave correctly at runtime.

**Not done, and the main gap in this doc:** no automated extension test exists (e.g.
`@vscode/test-cli`/`@vscode/test-electron` driving a real Extension Development Host), and no one has
yet pressed F5 and run the command against a real workspace with `DomainProcessBinding__mdt` source
or a connected org to confirm the webview actually renders and groups bindings the way Behavior
describes. Until that happens, "the extension compiles" is the only verified claim — the actual
QuickPick flow, webview rendering, theme-token CSS, and row-click-to-open-class behavior are all
unverified against a live VS Code instance.

## Open questions

- **Manual Extension Development Host smoke test.** Owned by whoever runs F5 next — compare the
  rendered panel against `basicview.png` and report back anything that doesn't match or looks wrong.
  This is the one item blocking calling this doc's Status `Implemented`.
- **No automated test harness yet.** Worth adding (`@vscode/test-cli` at minimum, exercising the
  QuickPick flow with mocked `sf` output) once the manual smoke test above confirms the current
  design is right — no point writing tests against a UI that might still change shape.
- **`src/at4dxCli.ts`'s row-shape mirror drifting from `@simplysf/simply-aep`.** Today this is a
  manual sync (see Implementation plan #2). Acceptable while one person maintains both repos; worth
  a shared `@simplysf/*` types package if that stops being true, or if a second extension ever needs
  the same shape.
- **Extension icon is an unresized, uncompressed 1254×1254 / ~941 KB PNG**, reused as-is from
  `simply-extension-pack`. Fine for now; revisit if `.vsix` size becomes a real concern.
- **Persistent sidebar tree view**, once/if the data source is cheap enough to refresh reactively
  (see Alternatives considered) — not designed here, tracked as a possible follow-up.
- **Namespaced AT4DX installs** — out of scope, matching the CLI-side docs' stance (0007/0008 in the
  `simply` repo): no known consumer needs it yet.
