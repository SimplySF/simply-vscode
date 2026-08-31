# Simply AT4DX for Visual Studio Code

Explore [AT4DX](https://github.com/apex-enterprise-patterns/at4dx) framework bindings without leaving VSCode.

- View bindings from local source and connected orgs
- Edit bindings from local source and connected orgs
- Reports errors with configured bindings and sequence collisions

## Usage

The panel is titled **AT4DX Explorer** and carries a tab strip across the top for the framework's
different explorers — **Domain Process Bindings** and **Application Factory** are both live;
**Platform Events** still shows as an inert `Coming soon` tab, reserved for a later addition.
Application Factory scans lazily: switching to it the first time triggers its own scan against
whatever source you picked, so opening the panel never pays for a scan you didn't ask to see.

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
than one primary action on screen. Either opens a form for every `DomainProcessBinding__mdt` field,
grouped into three sections — Identity, When it runs, What it does — with a live sentence above them
showing the binding you're about to save (e.g. "When an Account is Created, run the Action
`AssignOwner.cls` at order `10.3` during Trigger Execution"), recomputed as you type. Developer Name
is fixed once you're editing an existing record, since renaming one is really a delete-and-recreate
from Salesforce's own perspective.

Saving writes to whatever you picked when you opened the panel: a local folder gets its
`.md-meta.xml` file created or updated on disk; a connected org gets the equivalent record deployed
directly, with nothing left in your workspace. If the write would introduce a wiring problem AT4DX
validation already knows how to catch — an order collision, a duplicate Developer Name, and so on —
the form stays open with the issue(s) shown and the button becomes **Save Anyway**, so you can push
through deliberately instead of guessing why nothing happened. A successful save re-scans and
refreshes the panel immediately, so the new or changed binding (and anything it now flags) shows up
right away.

### Application Factory bindings

The **Application Factory** tab reads the four `ApplicationFactory_{Service,Selector,Domain,
UnitOfWork}Binding__mdt` Custom Metadata Types — which Apex class implements which interface, which
selector/domain handles which SObject, and which SObjects join the shared Unit of Work — grouped into
one section per binding type, in the order Service, Selector, Domain, Unit of Work. Click **+ New
Binding** to create a binding of any of the four types, or the pencil icon on any row to edit one — the
form picks up the same wiring-problem/**Save Anyway** contract the Domain Process form already uses. A
Selector, Domain, or Unit of Work binding's SObject field flags a standard object that can't support a
metadata relationship (e.g. `Task`) in red with a **"Use … as an alternate name"** action, rather than
blocking the save outright — the underlying eligibility table is explicitly best-effort. A Unit of Work
binding's only extra field is an optional Commit Sequence number; the create/edit form's live preview
shows where it would land in the commit order (`1st`, `2nd`, ...) against every other Unit of Work
binding already in the scan, so reordering is editing that number rather than dragging a row.

Each Service/Selector/Domain row shows its resolution — **Effective** (this is the one AT4DX actually
uses), **Shadowed** (a higher-priority binding for the same key won instead), or, for Domain, which has
no priority field to break a tie, **Ambiguous**. Two Service/Selector bindings tied on priority render
an amber banner over the group, with **Resolves today** on the one AT4DX currently picks and **May win
instead** on the rest — that's a "this isn't deterministic" notice, not an error, since AT4DX itself
still resolves one and `binding validate` doesn't fail on it. The Unit of Work section is a commit-order
list instead — every record contributes, ordered by its sequence (`1st`, `2nd`, ...; a shared sequence
renders as a shared `2nd or 3rd`-style range; no sequence at all renders as unordered).

A Problems section below the sections lists everything Application Factory validation catches — a
missing or ambiguous SObject reference, a standard object that can't support a metadata relationship
(e.g. `Task`), a duplicate `To__c`/SObject/sequence, and so on — grouped errors-then-warnings, with the
same click-to-open-the-file behavior as the Domain Process explorer's own Issues section.

## Troubleshooting

Every binding lookup logs a one-line summary (source, duration, outcome) to the
**AT4DX Explorer** output channel (View → Output, then pick it from the dropdown) —
no setup needed. If something's failing and you need to share more detail in a bug report, turn on
the **`simply-at4dx.debug`** setting, reproduce the problem, and copy the channel's contents: with it
on, entries also include the org/source detail and captured error output. It's off by default since
that detail can include org usernames and local file paths.
