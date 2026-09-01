# 0018 — AT4DX Platform Events tab

**Status:** Implemented (automated tests only — the manual F5/testfixtures/connected-org pass this doc's
own Testing section calls for hasn't been run yet)
**Extension:** `extensions/simply-at4dx`
**Date:** 2026-09-01

## Problem

[0017](0017-at4dx-bindings-redesign.md) shipped the SObject Bindings / Domain Process Bindings / Service
Bindings tabs and left the fourth tab, **Platform Events**, permanently `Coming soon` — at the time, turn
7 of the `AT4DX Bindings Redesign.dc.html` canvas didn't exist yet, and the CLI library had no support at
all for `PlatformEvents_Subscription__mdt` (AT4DX's Platform Event Distributor registration table).

Both gaps are now closed. The canvas gained a seventh turn (`7a`–`7e`) drawing the explorer, a match
simulator, and a create drawer. Separately — a different repo, a different track — `simply-node`'s
`packages/simply-aep-core` shipped the CLI library support this tab depends on, in three stages already
landed on `main` (v0.13.0): `Types`/`LocalScan`/`OrgScan`/`validatePlatformEventSubscriptions` (list/
validate), `resolvePlatformEventDistribution` (the match simulator), and
`createPlatformEventSubscription`/`updatePlatformEventSubscription` (write). This repo's own
`extensions/simply-at4dx/package.json` still pins `^0.9.0`, which predates all of it.

The reason this tab matters more than it might look: `PlatformEventDistributor` swallows every consumer
construction/execution failure into three `System.debug` calls and nothing else. A subscription naming a
missing class, or wired to a matcher rule that dereferences a blank field, fails silently in the org —
nothing surfaces anywhere except this panel, once it exists.

**Load-bearing finding from reconciling the canvas against the real library:** turn 7's mockups draw the
CMDT's `MatcherRule__c` picklist as four values named `MatchEventBusAndCategoryAndEventName` /
`MatchEventBusAndCategory` / `MatchEventBusAndEventName` / `MatchEventBus`. The library that actually
shipped (`at4dxPlatformEventSubscriptionTypes.ts`) names the same four concepts
`MatchCategoryAndEvent` / `MatchCategory` / `MatchEvent` / `MatchEventBus`, with an explicit comment on
the type that the exact spelling "isn't independently confirmed against AT4DX's own picklist definition
... verified against a real org's picklist the first time this module is exercised there." This doc
builds against the library's real enum values (the only ones that will actually deploy), while keeping
the canvas's human-readable labels ("Match Event Bus and Category and Event Name", etc.) as the dropdown's
display text — see "Deviations from the canvas" below.

## Decision

Build the tab as a single stage, matching the CLI's own three landed stages one-to-one: list/validate,
simulate, create/edit. Unlike 0016/0017 there is no reason to spread this across multiple PRs — the
library work these depend on is already done, so nothing here is blocked on a future landing.

1. Bump `@simplysf/simply-aep-core` to `^0.13.0` (published; confirmed on the npm registry).
2. `src/platformEventCli.ts` — a new host-side wrapper, mirroring `applicationFactoryCli.ts`'s shape:
   dynamic `import()` of the ESM-only library (same reason as every other CLI wrapper here — see
   docs/design/0006), `getPlatformEventSubscriptions` (list + validate together, same pattern as
   `getApplicationFactoryBindings`), `simulatePlatformEventDistribution` (a thin async wrapper around
   the library's pure, synchronous `resolvePlatformEventDistribution` — needed only because the webview
   can't import the ESM-only package directly), `createSubscription`/`updateSubscription`.
3. `at4dxExplorerPanel.ts` — a fourth `ExplorerKey` (`'platformEvents'`), lazily scanned on first visit
   exactly like Application Factory (`triggerPlatformEventsScanIfNeeded`), sharing the same
   `BindingSource` `target` every explorer already reads. New message handlers: `submitPlatformEvent`
   (create/edit, same blocked-vs-thrown contract as every other write), `simulatePlatformEvent`
   (read-only, no rescan — see below).
4. Webview: `lib/platformEventView.ts` (grouping, row-status derivation, matcher-rule display/required-
   field logic), `PlatformEventsSheet.svelte` (the bus→category→subscription tree, 7a),
   `PlatformEventSimulateDrawer.svelte` (7b), `PlatformEventForm.svelte` (7c, create/edit), wired into
   `App.svelte`'s existing tab-strip/drawer machinery as a fourth tab.

### Deviations from the canvas

Per `docs/design/README.md`'s own instruction and this project's `SPEC-CONVENTIONS.md` rule that copy is
the spec *unless it's wrong* — reconciled against the real library, same posture 0017 already took:

1. **`MatcherRule__c`'s four API values are not what the canvas implies** (see "Load-bearing finding"
   above). The dropdown keeps the canvas's exact human-readable labels; the value underneath each one is
   the library's real enum member (`MatchEventBus` / `MatchCategory` / `MatchEvent` /
   `MatchCategoryAndEvent`). If a real org's picklist turns out to use different API names than the
   library assumes, that's a `simply-aep-core` bug to fix there, not something this panel can route
   around.
2. **`non-conforming-event-bus` never fires, and the bus-level `CONFORMS` / `NOT A VALID BUS` badge (7a)
   is dropped.** The rule exists in `validatePlatformEventSubscriptions` but is gated on an
   `eventBusFields` map (each platform event bus's known field names) that neither
   `scanLocalPlatformEventSubscriptions` nor `scanOrgPlatformEventSubscriptions` builds — the
   handoff spec (`HANDOFF-05` §4) called for local scans to read `objects/<Bus>__e/fields/` and org scans
   to `describe`, but the shipped library has neither. Building that map ourselves in this extension
   would be a second, unaudited implementation of the same schema-reading `simply-aep-core` was supposed
   to own — rejected for the same reason 0017 rejected faking Active/Delete against fields that don't
   back them. `validatePlatformEventSubscriptions` is called with no `eventBusFields` argument, which is
   itself the library's own designed "haven't looked, so say nothing" behavior — the rule silently never
   fires rather than lying about a bus's conformance. Every bus band in this pass shows its name and
   category/subscription counts only. Tracked as a follow-up once the library grows the field map (either
   side — CLI or panel — reading it locally is a smaller, separable addition).
3. **The Consumer class field's "✓ Implements `IEventsConsumer` · not yet subscribed elsewhere" live hint
   (7c) is dropped to a plain text input with no live check at all.** The "implements `IEventsConsumer`"
   half needs Apex workspace resolution this extension doesn't have — the same class of problem 7e itself
   flags as deferred (consumer-class-not-found / doesn't-implement-`IEventsConsumer`, grouped with the
   still-deferred `Implements TriggerAction` check from 0014). The "not yet subscribed elsewhere" half
   *is* derivable client-side from the already-scanned records (a live duplicate-consumer check), but
   splitting one hint line into "one real check, one we can't back" reads worse than dropping it entirely
   and relying on `duplicate-consumer`'s existing server-side `validate` pass on submit — the same
   blocked-issue flow every other drawer already uses for its own scan-scoped rules (e.g. Selector's
   `duplicate-fieldset-name`).
4. **No Active checkbox in the create drawer, matching the canvas's own footer note** ("`IsActive__c`
   defaults true") rather than a state to omit by policy the way 0017 dropped it for Application Factory
   types — here the CMDT genuinely has the field and the library's create/update both accept `isActive`,
   but the canvas's own 7c mockup never draws the checkbox either, so there's nothing to reconcile against
   library absence; this one's just consistent with what's drawn. Editing `IsActive__c` after creation
   isn't exposed by this stage — see "Not in this stage" below.
5. **7c's own markup never draws an Event Bus input**, even though `EventBus__c` is required
   (`CreatePlatformEventSubscriptionInput.eventBus`) and the drawer's own breadcrumb
   (`SUBSCRIBER  Sales_Event__e  ›  Account`) proves the concept is very much part of the form — this
   reads as an omitted field in that specific screenshot rather than a deliberate design choice (compare
   7a, which draws no per-bus "Add" entry point that could have pre-filled it — see the entry-point note
   below). The drawer adds a plain Event Bus text field as the first field in **Matching**, above Matcher
   Rule, since the matcher-rule hint text and the breadcrumb both read most naturally once the bus is
   named first.
6. **Clearing a populated `eventCategory`/`event` back to blank via the edit drawer is out of scope.**
   `updatePlatformEventSubscription`'s merge (`input.eventCategory ?? existing.eventCategory`) only
   treats `null`/`undefined` as "leave alone" — an explicit empty string *does* thread through as a real
   value, which is a usable clear path, but making the UI rely on that distinction (blank textbox → sent
   as `''` → merge treats it as "set to empty" vs. blank textbox on a field the rule doesn't need →
   omitted as `undefined`) is exactly the ambiguity `HANDOFF-05`'s own "decide-and-state" list left open
   and never resolved in the shipped library or its tests. This doc leaves it open too rather than
   guessing: the edit form always sends the field's current trimmed value (posting nothing changes
   nothing), and the way to make a populated match field irrelevant is to change `MatcherRule__c` to one
   that no longer dereferences it — the value stays on the record, unused, same posture Domain Process
   bindings already take toward a field with no deactivate path.

### Not in this stage

- **Consumer-class-not-found / does-not-implement-`IEventsConsumer` detection** (7e) — deferred, same
  workspace-Apex-resolution class of problem as 0014's still-deferred `Implements TriggerAction` check.
  One future doc should cover both plus `simply-vscode`'s own tab-switching note from 7e (moot here — see
  below).
- **`non-conforming-event-bus` / bus-conformance badges** — blocked on the library, see deviation 2.
- **Toggling `IsActive__c` after create, or any delete affordance** — the library has no delete for this
  family either (same posture as every other AT4DX type in this codebase); `isActive` can be flipped via
  a future edit-drawer field once there's a reason to design that UI, but the canvas's own 7c mockup never
  draws one, so nothing here regresses relative to the design.
- **7e's "tab switching is now real, and unspecified" item is already resolved, and was resolved before
  this doc was written** — 0014's tab strip and 0016/0017's `ExplorerKey`/lazy-scan machinery already
  answer it: one webview, one top tab strip, N explorers sharing a `BindingSource`. Platform Events is
  simply a fourth `ExplorerKey` value using the same machinery Application Factory already proved out
  twice. No new mechanism, no open question.

## Behavior

### Tab strip

`SObject Bindings | Domain Process Bindings | Service Bindings | Platform Events`, replacing the inert
`Coming soon` tab from 0017. Lazily scanned on first visit (`triggerPlatformEventsScanIfNeeded`), same
target as every other explorer. An empty result — no records and no malformed entries, from either a
local scan or an org whose `PlatformEvents_Subscription__mdt` CMDT is missing — renders `{ kind: 'empty'
}`, **not** an error: this is an optional AT4DX family (a project can use the Trigger Action Framework
and/or Application Factory without ever touching the Platform Event Distributor), matching
`getFieldSetInclusions`'s existing posture rather than `getDomainProcessBindings`'s stricter one.

### The explorer (7a)

One band per distinct `eventBus` value present in the scan (bus names sorted alphabetically — the canvas
doesn't specify an order and scan order isn't meaningful here), each containing one sub-band per distinct
`eventCategory` value among that bus's records (also alphabetical), plus a trailing **No category** band
for records with a blank `eventCategory__c` ("bus-wide subscriptions", 7a's own copy) when any exist.
Grid: `92px minmax(0,1fr) 168px 124px 66px 84px 26px` (SUBSCRIBER pill / consumer class / rule label /
event value / sync-or-async / status / edit icon), copied verbatim from 7a.

Per-row derivation, in priority order (a record can only be in one of these states):

| Row state | Condition | Status column | Row treatment |
| --- | --- | --- | --- |
| Inactive | `!record.isActive` | grey dot, "Inactive" | 55% opacity, same convention as every other tab's `.row.inactive` |
| Throws | `matcher-rule-missing-field` issue for this record | red dot, "Throws" | red-tinted row + inline hazard note below it, exact copy from `PLATFORM_EVENT_SUBSCRIPTION_RULES`/issue message, worded to name whichever of `EventCategory__c`/`Event__c` is actually blank |
| Never fires | `unreachable-subscription` issue for this record | orange dot, "Never fires" | orange-tinted row + inline hazard note, canvas 7a copy verbatim |
| Active | none of the above | green dot, "Active" | plain |

The **event value column** shows the record's real `event` value (mono, foreground color) whenever
`matcherRule` dereferences it (`MatchEvent`/`MatchCategoryAndEvent`) and it's present; `any` (mono, muted)
when the rule doesn't dereference it (`MatchEventBus`/`MatchCategory`); a red `⚠ blank` when the rule
dereferences it but it's empty — the `matcher-rule-missing-field` hazard, canvas 7a's own
`OppStageNotifyConsumer` row. `EventCategory__c` has no column of its own (it's the band the row sits
under) — a record missing *only* `EventCategory__c` under `MatchCategory`/`MatchCategoryAndEvent` still
gets the row-level Throws treatment and a hazard note that names the right field, it just doesn't get a
second "blank" glyph with nowhere to put it.

Bus header: name (mono, bold), category/subscription counts (`N categories · N subscriptions`). Category
sub-header: category name (mono, periwinkle `#c8c8ff` per turn 7's own "type hue is periwinkle" note),
`N subscription(s)` and, when any exist, `· N problem(s)` (Throws + Never-fires rows counted together,
matching the canvas's own combined count).

Toolbar: `N subscriptions across N event buses. Each consumer subscribes once — Consumer__c is unique.`
(verbatim, pluralized), a red `⚠ N problems` summary (errors + warnings combined, matching the canvas's
single chip — the detailed Errors/Warnings split still lives in the Issues section below it, same
convention every other tab already uses), `Simulate a match…` (opens the simulate drawer, 7b), `+ New
Subscription` (plain button, no split menu — there's only one creatable type here, same reasoning 0017
gave the Service Bindings tab's own non-split button).

Issues section below the tree: reuses `IssueEntry.svelte`/the errors-then-warnings layout every other
tab already has (`ApplicationFactoryIssuesSection.svelte`'s own shape, retargeted at
`PlatformEventSubscriptionIssue`), clicking an entry opens the source `.md-meta.xml` the same way
`openApplicationFactoryIssue` does.

### Match simulator (7b)

`Simulate a match…` opens a 560px drawer (same `.drawer-panel`/`.drawer-backdrop` chrome every other
drawer already uses) with an Event Bus dropdown (populated from the scan's own distinct `eventBus`
values) and `Category__c`/`EventName__c` text inputs. Every keystroke re-runs the simulation — this needs
no host round trip's *scan* cost since `resolvePlatformEventDistribution` is a pure function over
already-scanned records (7e's third open item, resolved: the simulator needs the workspace's already-
scanned metadata, never an org round trip beyond the same one `list` already did) — but it does need one
host message per keystroke (`simulatePlatformEvent` → `simulateResult`) since the webview can't import the
ESM-only library itself, same constraint every other CLI call in this panel already works around.

Renders `N of M subscriptions on this bus would receive it`, then the matched consumers in order (green,
numbered, `in-process` or `⟳ N Queueable` per `executeSynchronous`), then a `DID NOT MATCH` list — one
line per miss, `developerName` plus a reason clause derived from `PlatformEventDistributionMissReason`:

| `reason` | Clause |
| --- | --- |
| `inactive` | "Inactive — never loaded into the DI module" |
| `prefiltered` | "Dropped by the pre-filter — no category or event name to match on" |
| `matcher-rule-missing-field` | "Category is `X` — but this record would throw before reaching the comparison" (or the equivalent Event-based clause when it's `event` that's missing) |
| `no-match` | "Category is `X`" / "Event is `X`" / "Category is `X`, event is `Y`" — whichever of the record's own match field(s) the simulated event didn't equal, per its `matcherRule` |

Copy for `inactive`/`prefiltered`/`matcher-rule-missing-field` is canvas 7b verbatim; `no-match`'s clause
isn't drawn in the canvas (7b's own example has no plain non-match miss) and is templated here from the
same "state the field that differs" convention the other three already use.

### Create/edit drawer (7c)

`PlatformEventForm.svelte`, same drawer chrome as every other type, opened by `+ New Subscription`
(create, nothing pre-filled) or a row's `✎` icon (edit). Sections, in order: **Matching** (Matcher Rule
select — four options, canvas labels verbatim, library enum values underneath per deviation 1; Event
Category / Event text inputs, each required exactly when the selected rule dereferences it, with the
"Both match fields below become required..." hint text generalized across all four rules, not just the
canvas's one drawn state — per `SPEC-CONVENTIONS.md`'s "a state shown once is a required state" rule
applied to the states the canvas *didn't* happen to screenshot); **Consumer** (Consumer class text field,
plain — deviation 3; Execute synchronous checkbox, canvas copy verbatim); **Record** (Developer Name,
locked in edit mode, same convention every other drawer already follows per 0017 deviation 6). Footer:
`Writes one .md-meta.xml file · IsActive__c defaults true` (create only), Cancel/Create or
Discard/Save changes buttons matching every other drawer's button pair.

RESULTING BINDING-equivalent preview and CLI-preview footer are **not** built for this drawer — turn 7's
own 7c mockup has neither (compare 3a/5c, which do), and there's no priority-competition or commit-
position concept to summarize for a family with no shared resolution state (deviation-free: this is
just what the canvas draws, not a cut).

Breadcrumb bar (`SUBSCRIBER  <eventBus>  ›  <eventCategory>`) is live copy computed from the form's
current field values, the same pattern `bindingDrawerCopy.ts` already uses everywhere else — not a
locked-at-open-time prefill, since there's only one entry point into this drawer (no per-band "Add" link
the way SObject Bindings cards have one) and 7c's own screenshot is simply what the breadcrumb looks like
once those two fields happen to be filled in.

## Alternatives considered

**Building our own `eventBusFields` map (reading `objects/<Bus>__e/fields/` locally, `describe` against
an org) to back `non-conforming-event-bus` and the bus CONFORMS/NOT A VALID BUS badge.** Rejected for
this pass — see deviation 2. `simply-aep-core` was specifically designed (per its own `HANDOFF-05`) to own
this read; duplicating it here risks the two copies drifting the way `SPEC-CONVENTIONS.md` warns against
for anything reimplementing distributor behavior. A follow-up CLI release is the right place for it.

**Deferring the whole tab further, pending the CLI catching up on `eventBusFields`.** Rejected — the four
hazard classes this tab *can* already surface (`missing-event-bus-or-consumer`,
`matcher-rule-missing-field`, `unreachable-subscription`, `duplicate-consumer`/`duplicate-developer-name`)
are the ones `PlatformEventDistributor`'s own silent-failure design makes worst to leave invisible; the
fifth (`non-conforming-event-bus`) is real but strictly less common (it requires a platform event object
itself to be missing standard fields, not just a subscription record to be misconfigured). Shipping four
of five now, with the fifth's gap documented rather than faked, is the same call 0017 made for Application
Factory's missing Active/Delete affordances.

**Naming the picklist values after the canvas's own guessed spelling** (`MatchEventBusAndCategoryAndEventName`
etc.) rather than the library's shipped enum. Rejected — the library's values are what will actually
(de)serialize against a real org's `MatcherRule__c` picklist; building the UI against copy that might not
match a real API name would silently break every write the first time this module meets a real org's
metadata, which is exactly the risk the library's own type-level comment flags.

## Implementation plan

1. `extensions/simply-at4dx/package.json` — bump `@simplysf/simply-aep-core` to `^0.13.0`, `npm install`.
2. `src/platformEventCli.ts` — new: `getPlatformEventSubscriptions`, `simulatePlatformEventDistribution`,
   `createSubscription`, `updateSubscription`, re-exported types, mirroring `applicationFactoryCli.ts`'s
   shape and logging conventions.
3. `src/at4dxExplorerPanel.ts` — `ExplorerKey` gains `'platformEvents'`; `PanelState`/`toInitialState`
   gain a `platformEvents: ExplorerState<PlatformEventsData>` slice; `selectExplorer`/a new
   `triggerPlatformEventsScanIfNeeded` mirror the Application Factory lazy-scan path;
   `submitPlatformEvent` (create/edit, rescan-and-render, mirrors `submitApplicationFactoryBinding`);
   `simulatePlatformEvent` (no rescan, no render — posts `simulateResult` straight back, mirroring the
   "targeted message, still-mounted view" pattern `submitFieldSetInclusion` already established for a
   write that shouldn't remount the panel — simulate isn't even a write, so the same reasoning applies
   even more directly); `openPlatformEventIssue`, mirroring `openApplicationFactoryIssue`.
4. `src/webview/types.ts` — mirrored type re-exports from `platformEventCli.ts`; `ExplorerKey`,
   `InitialState.platformEvents`, `PlatformEventFormPayload`, `PlatformEventFormInitial`.
5. `src/webview/lib/platformEventView.ts` — new: bus/category grouping, per-row status derivation, the
   matcher-rule label/required-fields table, the miss-reason clause builder, `partitionBySeverity`-style
   issue splitting (reusing `applicationFactoryView.ts`'s existing helper where the shape already matches
   rather than re-deriving it).
6. `src/webview/PlatformEventsSheet.svelte`, `PlatformEventSimulateDrawer.svelte`,
   `PlatformEventForm.svelte` — new.
7. `src/webview/App.svelte` — fourth tab wired into the existing tab-strip/lazy-scan/drawer machinery;
   new CSS block for the bus/category bands and rows (`.pe-*` classes), following
   `SPEC-CONVENTIONS.md`'s literal-grid-track and derived-color rules the same way every existing block
   already does.
8. `extensions/simply-at4dx/README.md` — Usage section gains the fourth tab.
9. This doc's `Status` line → `Implemented` once it lands.

## Testing

Mirrors 0016/0017's split between derivation unit tests and component tests:

- `platformEventCli.test.ts` — local/org scan paths, the org-`missing`-treated-as-empty path (not an
  error), create/update's blocked-vs-thrown contract, mirroring `applicationFactoryCli.test.ts`'s shape.
- `platformEventView.test.ts` — bus/category grouping (including the "No category" band), the per-row
  status table above (one case per row state plus the negative case), the matcher-rule required-fields
  table, the miss-reason clause builder (one case per `PlatformEventDistributionMissReason`, plus
  `no-match`'s field-naming logic for a Category-only, Event-only, and both-fields rule).
- `PlatformEventsSheet.test.ts` / `App.test.ts` extensions — tab renders, lazy scan fires once, each row
  state's markup, the issues section, `Simulate a match…` opens the drawer and results update per
  keystroke without a full panel re-render, `+ New Subscription` and a row's edit icon open the form with
  the right mode/prefill.
- `PlatformEventForm.test.ts` — matcher-rule selection toggling which fields are required and their hint
  text (all four rules, not just the canvas's one drawn state, per `SPEC-CONVENTIONS.md`), create/edit
  payload shapes, blocked/error message handling matching every other drawer's existing pattern.
- Copy assertions per `SPEC-CONVENTIONS.md` §1 throughout: every user-visible string asserted against the
  canvas's wording verbatim where the canvas draws it, and against this doc's own templated wording where
  it doesn't (the `no-match` clause, the generalized required-field hint).
- **Manual** (F5): confirm the tab against `testfixtures/` (needs `PlatformEvents_Subscription__mdt`
  fixtures added — none exist yet, same gap 0016 flagged for Application Factory before its own fixtures
  landed) plus one connected-org pass before marking this doc `Implemented`.

## Open questions

- **`eventBusFields`** — blocked on `simply-aep-core` growing the read (deviation 2). Not blocking this
  stage; tracked as a follow-up in whichever repo ends up owning it.
- **Consumer-class-not-found / `IEventsConsumer` detection, and `Implements TriggerAction`** (0014) — one
  future doc should cover all the workspace-Apex-resolution checks this codebase has now deferred twice,
  per 7e's own framing.
- **Clearing a populated match field via edit** (deviation 5) — left open, matching `HANDOFF-05`'s own
  unresolved "decide-and-state" item; revisit once/if the library's update semantics grow a real
  clear-vs-leave distinction.
- **`MatcherRule__c`'s real API picklist spelling** — the library's own type comment flags this as
  unverified against a real org. If a connected-org pass during this doc's manual testing surfaces a
  mismatch, that's a `simply-aep-core` fix, not a `simply-vscode` one — noted here so it isn't mistaken
  for a panel bug if a create/update fails validation against a real picklist for a reason unrelated to
  anything this doc controls.
