# Design Documents

Every new extension — or any feature that changes what an existing extension does — gets a design
document here **before** it gets code. The point isn't ceremony — it's that a year from now, the
"why" behind an extension's shape (why a webview instead of a tree view, why it shells out instead of
reimplementing, what we rejected) is recoverable without archaeology through git history and PR
threads. This mirrors the process the companion `simply` CLI repo already uses for its own
`docs/design/` — see
[SimplySF/simply-node's docs/design/README.md](https://github.com/SimplySF/simply-node/blob/main/docs/design/README.md) —
adapted here for `extensions/*` instead of `packages/*`.

## Process

1. **Write the design doc first.** Copy the [template](#template) into
   `docs/design/NNNN-short-slug.md`, using the next free four-digit number.
2. **Get agreement on it** — on the doc, not on the diff. Decisions are cheapest to change here.
3. **Implement**, then update the doc if the implementation taught you something the design got
   wrong. A design doc that quietly diverges from the shipped behavior is worse than none.
4. **Set the status line** to `Implemented` (with the PR link) when it lands.

A design doc is not a substitute for user-facing docs. What a command does, how to invoke it, and
setup requirements still live in each extension's own `README.md` and `CHANGELOG.md`. The design doc
records the reasoning; the extension's `README.md` records the behavior.

## When a design doc is required

- Any new extension under `extensions/`.
- Any new command an existing extension contributes, or a change to an existing command's behavior,
  UI, or data source that users would notice.
- Any change to how an extension gets its data (e.g. switching from shelling out to a CLI to reading
  metadata directly), or to shared release/packaging conventions (see `RELEASING.md`).

Not required for: bug fixes that restore documented behavior, dependency bumps, copy/wording tweaks,
refactors that keep the observable behavior identical.

## Index

| #                                                                          | Title                                    | Status |
| --------------------------------------------------------------------------- | ----------------------------------------- | ------ |
| [0001](0001-at4dx-domain-process-binding-explorer.md) | AT4DX Domain Process Binding Explorer | Draft  |
| [0002](0002-at4dx-debug-output-channel.md) | AT4DX Debug Output Channel | Implemented |
| [0003](0003-at4dx-panel-loading-state.md) | AT4DX In-Panel Selection & Loading State | Implemented |
| [0004](0004-at4dx-choose-source-folder.md) | AT4DX Choose Source Folder | Implemented |
| [0005](0005-at4dx-org-list-via-core.md) | AT4DX Org List via `@salesforce/core` | Implemented |
| [0006](0006-at4dx-direct-library-imports.md) | AT4DX Domain Process Bindings via Direct Library Imports | Implemented |
| [0007](0007-at4dx-validate-viewed-bindings.md) | Validating the Bindings You're Viewing | Implemented |
| [0008](0008-at4dx-default-source-folder.md) | AT4DX Default Source Folder | Draft |
| [0009](0009-at4dx-create-edit-domain-process-bindings.md) | Create & Edit Domain Process Bindings | Draft |
| [0010](0010-automated-test-harness.md) | Automated Test Harness | Implemented |
| [0011](0011-at4dx-svelte-webview.md) | AT4DX Webview Rewritten in Svelte | Implemented |
| [0012](0012-at4dx-row-flag-indicators.md) | Prevent Recursive & Logical Inverse Row Indicators | Superseded by 0013 |
| [0013](0013-at4dx-bindings-panel-redesign.md) | AT4DX Bindings Panel List & Form Redesign | Draft |

## Template

```markdown
# NNNN — Title

**Status:** Draft | Planned | Implemented (PR #N) | Superseded by NNNN
**Extension:** the `extensions/*` this lands in
**Date:** YYYY-MM-DD

## Problem

What the user can't do today, and why that hurts.

## Decision

The one-paragraph answer: what we're building and where it lives.

## Behavior

The user-visible contract — command name(s), UI flow, what's shown, what happens on error. Tables
and short flow sketches beat prose for lookup.

## Alternatives considered

Each option we rejected and the specific reason. This section is the one future readers come back
for.

## Implementation plan

Files added/changed, in the order they'd be written.

## Testing

What's automated (compile checks, unit tests if any), what's manual (e.g. F5 in the Extension
Development Host), and what each covers.

## Open questions

Anything deliberately left undecided, and who decides it.
```
