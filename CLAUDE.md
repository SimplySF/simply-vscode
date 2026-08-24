# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Before writing code for a new feature

Every new extension under `extensions/`, or any user-visible change to an existing one, gets a
design document in `docs/design/` **before** it gets an implementation. Read `docs/design/README.md`
for the process, the template, and the list of changes that require a doc (new extensions, new
commands, UI/behavior changes, changes to how an extension gets its data). In short:

1. Write `docs/design/NNNN-short-slug.md` from the template, using the next free number.
2. Get the design agreed on before implementing — decisions are cheapest to change there.
3. Implement, then correct the doc wherever the implementation taught you something better; a doc
   that silently disagrees with the shipped behavior is worse than no doc.
4. Add the row to the index table in `docs/design/README.md` and update the doc's `Status` line when
   the work lands.

The point is that the reasoning behind an extension's shape — why a webview instead of a tree view,
why it shells out to `sf` instead of reading Salesforce metadata directly, what was rejected — stays
recoverable later, instead of dying in PR threads. The doc records the reasoning; each extension's own
`README.md` records the user-facing behavior. Neither substitutes for the other.
