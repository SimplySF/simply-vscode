# 0002 — AT4DX Debug Output Channel

**Status:** Implemented (PR #8)
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-08-25

## Problem

Diagnosing a bad `sf` invocation today means getting on the affected machine yourself, opening
`src/at4dxCli.ts` or `src/extension.ts` in a dev checkout, sprinkling in temporary `console.log`
calls, pressing F5 to launch an Extension Development Host, reproducing the issue, reading the
result in the *original* window's Debug Console, and then remembering to strip the logging back out
afterward. That's exactly what happened diagnosing the "Reading AT4DX Domain Process Bindings…" hang
(see the commit history around the `execa` migration): it worked, but only because a developer with
the source checked out was available to do it live.

It falls apart the moment the report comes from someone else's machine, which is the normal case for
a published Marketplace extension. There's no way for a consumer to hand back "here's what `sf`
actually did" without either screen-sharing a live debugging session or being talked through manually
running the equivalent `sf` command by hand and hoping it reproduces the same way outside the
extension host (which, per the hang investigation, it may not — the failure was specific to how the
extension host spawns the process).

## Decision

Add a persistent `vscode.OutputChannel` that every `sf` invocation always writes a short, non-sensitive
summary line to (subcommand, duration, outcome), and a `simply-at4dx.debug` boolean setting (default
`false`) that, when enabled, additionally logs the full command, working directory, relevant
environment-variable presence, and captured stdout/stderr (truncated, with any proxy-URL credentials
redacted). A user hitting a problem flips the setting, reproduces it, and copies the channel's
contents into a bug report — no debugger, no source checkout, no F5.

`at4dxCli.ts` stays free of a direct `vscode` import: it takes a small `Logger` interface rather than
an `OutputChannel` directly, preserving the existing separation between the CLI-shelling logic and
extension-host glue (see 0001's Alternatives, which made the same call for testability/reuse reasons).

## Behavior

### Setting

`simply-at4dx.debug` (boolean, default `false`):

> Log detailed `sf` command-line invocations — including working directory, arguments, and captured
> output — to the "AT4DX Domain Process Bindings" output channel. Turn this on when troubleshooting,
> reproduce the problem, then share the channel's contents in a bug report. Off by default since
> arguments and output can include org usernames and local file paths.

Read fresh via `vscode.workspace.getConfiguration('simply-at4dx').get('debug')` on each invocation —
no reload required to take effect, matching how VS Code settings normally behave.

### Output channel

One channel, created once in `activate()` and disposed via `context.subscriptions`, named
"AT4DX Domain Process Bindings". Every call to `getDomainProcessBindings` or `listOrgs` writes:

- **Always:** one summary line — timestamp, which subcommand ran (`simply aep at4dx
  domain-process-binding list` / `org list`), duration, and outcome (`ok`, `sf not found`, `timed
  out`, `exited N`, `bad JSON`).
- **Only when `simply-at4dx.debug` is `true`:** the full argument list, `cwd`, `HTTPS_PROXY`/
  `HTTP_PROXY`/`NO_PROXY` (redacted — see Security below — rather than omitted, since the host alone
  is often what's actually needed to diagnose a proxy issue), and captured stdout/stderr truncated to
  20 KB each.

### Error UX

Superseded by 0003, landed after this doc was first drafted: errors no longer go through a separate
notification (`reportError` doesn't exist anymore) — they render inside the panel itself. The panel's
error state text gets an appended line pointing at the output channel, worded differently depending on
whether `simply-at4dx.debug` is currently on (channel already has full detail) or off (channel has the
summary line; flip the setting and retry for full detail).

### Security: redaction

`HTTPS_PROXY`/`HTTP_PROXY` values can embed credentials (`http://user:pass@proxy:8080`). Even in debug
mode, only presence/host is logged, never the raw value — a small `redactProxyUrl()` helper strips
`user:pass@` before anything derived from these variables is ever written to the channel. Command
`args` and `stdout`/`stderr` are logged as-is in debug mode (org usernames and workspace paths can
legitimately appear there and are needed to diagnose the problem); this is called out explicitly in
the setting's description so a user knows what they're opting into before sharing a log publicly.

## Alternatives considered

**Relying on VS Code's built-in Extension Host log level (`Developer: Set Log Level…` → Trace) plus
plain `console.log` calls.** This already technically works for any user today, not just F5 sessions —
`console.log` from extension code surfaces in the "Log (Extension Host)" output channel regardless of
how VS Code was launched. Rejected as the *only* mechanism: it requires knowing that command exists,
interleaves with every other extension's trace output, and gives no control over what's redacted
versus always-on. The temporary `console.log` instrumentation added during the hang investigation
should be removed once this channel replaces it, to avoid double-logging.

**A dedicated diagnostics webview.** Overkill for "show me some text you can copy" — the existing
`DomainProcessBindingPanel` webview exists because the data has real structure to render; a log is
just a log, and `OutputChannel` is VS Code's standard, expected home for exactly this.

**An environment-variable-driven toggle (e.g. `AT4DX_DEBUG=1`).** Rejected: needs a persistent
system/user environment variable and a full VS Code restart to take effect on Windows, with zero
in-app discoverability. A workspace/user setting is instant and shows up in the Settings UI search.

**Logging full verbose detail unconditionally, with no setting.** Rejected: leaks org usernames and
absolute file paths into the channel by default for every user, including the overwhelming majority
who never hit a problem, and adds noise that makes the channel less useful precisely when someone
does need it.

## Implementation plan

1. `package.json` — add `contributes.configuration` with the `simply-at4dx.debug` property described
   above.
2. `src/logger.ts` (new) — a small `Logger` interface (`log(message: string, opts?: { verbose?:
   boolean }): void`) and a `createOutputChannelLogger(channel: vscode.OutputChannel)` factory that
   reads `simply-at4dx.debug` fresh on each verbose call; also exports `redactProxyUrl()`.
3. `src/extension.ts` — create the channel + logger in `activate()`; pass the logger into the
   `getDomainProcessBindings`/`listOrgs` call sites; add the "Show Output" button to `reportError`.
4. `src/at4dxCli.ts` — add an optional `logger?: Logger` parameter to `getDomainProcessBindings`;
   replace the temporary debug `console.log`/stdout-stream-listener instrumentation added during the
   hang investigation with calls through this logger (summary line always, full args/env/output only
   under `verbose: true`); truncate stdout/stderr to 20 KB before logging.
5. `README.md` — document the setting and "how to get a debug log for a bug report."
6. `CHANGELOG.md` — entry.

## Testing

**Planned, manual (no automated extension test harness exists yet — see 0001's Open questions, still
unaddressed):**

- Toggle `simply-at4dx.debug` off/on, confirm summary-only vs. full-detail lines.
- Force each outcome (`sf` missing, timeout, non-zero exit, bad JSON) and confirm the summary line's
  outcome text matches and, in debug mode, the right detail is present.
- Set `HTTPS_PROXY` to a value with embedded credentials and confirm the channel never shows them,
  in either mode.
- Confirm the "Show Output" button on the error notification reveals the channel.

`npm run compile` (esbuild + `tsc --noEmit`) as the baseline check, as with every other change here.

## Open questions

- **Output channel and setting naming** — proposed above (`AT4DX Domain Process Bindings` /
  `simply-at4dx.debug`), open to bikeshedding before implementation.
- **Dedicated "AT4DX: Show Output" command vs. relying on the standard Output-panel channel dropdown.**
  Proposed: skip a dedicated command for v1, matching how most extensions handle this (e.g. ESLint) —
  add one later if users report not finding the channel.
- **A "Copy Debug Info" command** bundling recent log lines plus `sf --version`/extension version into
  one clipboard-ready block for bug reports. Nice-to-have, deferred — not designed here.
- **20 KB truncation cap** is a starting guess, not measured against a real pathological `sf --json`
  payload; revisit if it turns out to cut off output that actually mattered.
