# Simply AT4DX for Visual Studio Code

Explore [AT4DX](https://github.com/apex-enterprise-patterns/at4dx) framework bindings without leaving VSCode.

- View bindings from local source and connected orgs
- Edit bindings from local source and connected orgs
- Reports errors with configured bindings and sequence collisions

## Usage

The panel is titled **AT4DX Explorer** and carries a tab strip across the top for the framework's
different explorers — **Domain Process Bindings**, **SObject Bindings**, and **Service Bindings** are
all live; **Platform Events** still shows as an inert `Coming soon` tab, reserved for a later addition.
SObject Bindings and Service Bindings share one lazily-triggered Application Factory scan: switching to
either the first time triggers it against whatever source you picked, and switching between the two
afterward never re-scans.

Run **AT4DX: Open Explorer** from the Command Palette. You'll be prompted to:

1. Pick a workspace folder (if more than one is open).
2. Pick where to read bindings from — the whole workspace, a specific folder you browse to (handy
   for a multi-package-directory project), or a connected org. The connected-org list is read
   directly from your local Salesforce CLI auth files, not by shelling out to `sf org list`.

The panel then opens right away, with its SObject and Trigger Event dropdowns disabled while it
scans. Once the scan completes, the dropdowns populate and enable — pick an SObject, then a trigger
event (Created/Updated/Deleted/Undeleted) or Domain Method Execution, and the panel groups that
SObject's bindings into Before/After sections in execution order. Switching either dropdown re-renders
instantly, with no re-scan. Click a row to open its class.

Each section shows a real column grid — Order, Type, Class to Inject, Async, Recursion, Logical
Inverse, and Status — instead of one flex row of icons and a developer name. `Class to Inject` is the
row's identifier (clicking it, or anywhere in the row, opens the class). Async and Logical Inverse
render as `Yes` or a dim em-dash; Recursion (short for "recursion prevented") renders as `Disabled`
or a dim em-dash, so a whole section can be scanned at a glance without hovering anything. Below
roughly 700px those two columns drop out to keep the
remaining ones legible, with a tooltip on each cell so their state stays discoverable; the row's own
tooltip shows its developer name.

When a section's bindings span more than one order prefix (`10.1`–`10.3` vs `20.1`–`20.2`, following
the AT4DX convention where the integer part of `Execution_Order__c` is a unit of work and the
fraction orders the bindings inside it), the rows group into collapsible bands — a caption naming the
prefix, what it's made of (`1 criteria gates 2 actions`), and its order range. A section with only one
prefix renders no band at all. Collapsing a band never hides a problem: if any row inside carries an
issue badge, the caption shows a warning count while collapsed.

### Validation

Every scan is also validated, automatically — there's no separate command and nothing to turn on.
A summary bar above the dropdowns reads `✓ No problems found`, or `⚠ N errors · M warnings` split
into "in this SObject" and "elsewhere in this scan" so a clean-looking selection is never masking a
problem under a different SObject; clicking it scrolls to the Issues section. Any row with a problem
gets a colored badge naming it. Below the binding sections, an Issues section lists every problem
found, including ones that can't appear as a row at all — a binding with no SObject reference, for
example, is dropped from the SObject list entirely and only ever shows up here. Clicking a local
issue opens its `.md-meta.xml` beside the panel; org-sourced issues aren't clickable, since there's
no local file to open.

### Creating and editing bindings

Click **+ New Binding** in the panel toolbar to add a binding, prefilled with the SObject and Trigger
Event you're currently viewing, or click the pencil icon on any row to edit that binding. The toolbar
and its **+ New Binding** button are hidden the whole time either form is open, so there's never more
than one primary action on screen. A breadcrumb under the header names the scope the binding is locked
to and its Action/Criteria type; while creating, a monospace line under the "resulting binding" sentence
previews the equivalent `domain-process-binding create` command. Either opens a form for every
`DomainProcessBinding__mdt` field, grouped into three sections — Identity, When it runs, What it does —
with a live sentence above them showing the binding you're about to save (e.g. "When an Account is
Created, run the Action `AssignOwner.cls` at order `10.3` during Trigger Execution"), recomputed as you
type. Developer Name is fixed once you're editing an existing record, since renaming one is really a
delete-and-recreate from Salesforce's own perspective. **Execute asynchronously** only appears for an
Action — a Criteria row has no async concept, so the checkbox (and any stale value on an existing
record) is hidden and cleared rather than shown disabled.

Saving writes to whatever you picked when you opened the panel: a local folder gets its
`.md-meta.xml` file created or updated on disk; a connected org gets the equivalent record deployed
directly, with nothing left in your workspace. If the write would introduce a wiring problem AT4DX
validation already knows how to catch — an order collision, a duplicate Developer Name, and so on —
the form stays open with the issue(s) shown and the button becomes **Save Anyway**, so you can push
through deliberately instead of guessing why nothing happened. A successful save re-scans and
refreshes the panel immediately, so the new or changed binding (and anything it now flags) shows up
right away.

### SObject Bindings and Service Bindings

These two tabs read the four `ApplicationFactory_{Service,Selector,Domain,UnitOfWork}Binding__mdt`
Custom Metadata Types — which Apex class implements which interface, which selector/domain handles which
SObject, and which SObjects join the shared Unit of Work. See
[0017](../../docs/design/0017-at4dx-bindings-redesign.md) for the full design and its staging.

**SObject Bindings** groups Selector, Domain, and Unit of Work bindings into one card per SObject (any
SObject wired into at least one of the three). A card names its SObject, an "N gap(s)" indicator when
it's missing a Domain or a Unit of Work binding (Selector has no such floor — an SObject can have zero,
one, or several), and lists its bindings: each Selector row's priority and **WINS**/**SHADOWED** status
(the same resolution AT4DX itself computes — a higher `Priority__c` wins, a blank sorts lowest), each
Domain row's bound implementation, and the Unit of Work row's commit position and sequence. A missing
Domain or Unit of Work binding renders as its own row with an **Add** link, prefilled with the type and
SObject already fixed. Click **+ New Binding** — its caret opens a menu naming which of Selector, Domain,
or Unit of Work you're creating (each with a one-line note on how many are allowed per SObject and what
happens if you add a second) — or the pencil icon on any row to edit an existing one; either opens the
form with the type already fixed and picks up the same wiring-problem/**Save Anyway** contract the
Domain Process form already uses. A Selector, Domain, or Unit of Work binding's
SObject field flags a standard object that can't support a metadata relationship (e.g. `Task`) in red
with a **"Use … as an alternate name"** action, rather than blocking the save outright — the underlying
eligibility table is explicitly best-effort.

**Service Bindings** is a flat interface → implementation table. Each row shows its resolution —
**Effective** (this is the one AT4DX actually uses), **Shadowed** (a higher-priority binding for the same
interface won instead) — with priority the deciding field, same as Selector's. Two bindings tied on
priority render an amber banner over the group, with **Resolves today** on the one AT4DX currently picks
and **May win instead** on the rest — that's a "this isn't deterministic" notice, not an error, since
AT4DX itself still resolves one and `binding validate` doesn't fail on it.

A card whose SObject has a Unit of Work binding can also be reordered directly on the sheet: drag its
`⣿` handle, or use the Move Up/Down buttons beside it — both stage the same pending move, so keyboard and
pointer users get the identical result (this is the keyboard-operable equivalent an earlier release
deliberately deferred, since plain HTML5 drag-and-drop has none). Staged moves show in a bar at the top —
**Revert** discards them, **Save commit order** writes each one; if a save fails partway through, the bar
reports how many of the pending moves actually saved and which SObject stopped it, and the rest are left
unattempted rather than guessed at. Two cards sharing the same sequence show an amber `sequence-collision`
banner between them — both still register, only their relative order is indeterminate, so it's a warning,
never something that blocks a drag or a save. A card with no Unit of Work binding at all has nothing to
reorder — that's what its own **Add** row is for.

A Selector row's edit form has its own **Field set inclusions** section: which field sets `Selector`
queries include on top of the object's base fields, listed by API name with a **✕** to remove one and a
text field + **Add** to include another. Both write immediately and independently of the binding form's
own Save button — the drawer stays open either way, so adding a field set never interrupts whatever else
you were editing. Removing one deactivates rather than deletes it (the underlying metadata has no delete),
so it's never truly gone, just stops contributing. A SObject's total active count shows right on its
Selector row on the SObject Bindings sheet, e.g. "2 field sets."

Commit order can still be set directly, without dragging, via the Unit of Work binding's edit form —
its Commit Sequence number field's live preview shows where a typed value would land (`1st`, `2nd`, ...)
against every other Unit of Work binding already in the scan.

Every create/edit form's breadcrumb names its type (Selector/Domain/Unit of Work/Service) and how it was
opened — free-typed from the toolbar, or fixed from a card's own **Add** link — and a monospace line
previews the equivalent `binding create` command while creating. The "resulting binding" sentence itself
reflects live priority competition: creating or editing a Selector or Service binding that shares its key
with another one already in the scan says so — who wins, who's tied, or who shadows whom — the same
resolution AT4DX itself computes.

A Problems section below each tab lists what Application Factory validation catches for that tab's own
binding types — a missing or ambiguous SObject reference, a standard object that can't support a
metadata relationship (e.g. `Task`), a duplicate `To__c`/SObject/sequence, and so on — grouped
errors-then-warnings, with the same click-to-open-the-file behavior as the Domain Process explorer's own
Issues section.

## Troubleshooting

Every binding lookup logs a one-line summary (source, duration, outcome) to the
**AT4DX Explorer** output channel (View → Output, then pick it from the dropdown) —
no setup needed. If something's failing and you need to share more detail in a bug report, turn on
the **`simply-at4dx.debug`** setting, reproduce the problem, and copy the channel's contents: with it
on, entries also include the org/source detail and captured error output. It's off by default since
that detail can include org usernames and local file paths.
