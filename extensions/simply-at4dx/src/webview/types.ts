// Type-only imports — esbuild elides `export type {...} from '...'` entirely (no runtime import of
// `at4dxCli.ts`, which pulls in Node-only `@salesforce/core`), so this file is safe to import from
// browser-side webview code. See docs/design/0011.
export type {
    DomainProcessBindingIssue,
    DomainProcessBindingRow,
    DomainProcessBindingRules,
    DomainProcessType,
    ProcessContext,
    TriggerOperation,
} from '../at4dxCli';
// Same reasoning as above, for the Application Factory explorer's types — see docs/design/0016.
export type { ApplicationFactoryRules, At4dxBindingRow, BindingIssue, BindingIssueRule, BindingType, WritableBindingType } from '../applicationFactoryCli';
// Same reasoning again, for field set inclusions — see docs/design/0017's Stage 4.
export type { FieldSetInclusionIssue, FieldSetInclusionIssueRule, FieldSetInclusionRuleInfo, RawFieldSetInclusionRecord } from '../applicationFactoryCli';
// Same reasoning again, for Platform Event Distributor subscriptions — see docs/design/0018.
export type {
    MalformedPlatformEventSubscriptionRecord,
    MatcherRule,
    PlatformEventDistributionInput,
    PlatformEventDistributionMatch,
    PlatformEventDistributionMiss,
    PlatformEventDistributionMissReason,
    PlatformEventDistributionResult,
    PlatformEventSubscriptionIssue,
    PlatformEventSubscriptionIssueRule,
    PlatformEventSubscriptionRuleInfo,
    RawPlatformEventSubscriptionRecord,
} from '../platformEventCli';

import type { DomainProcessBindingIssue, DomainProcessBindingRow, DomainProcessBindingRules, DomainProcessType, ProcessContext, TriggerOperation } from '../at4dxCli';
import type { ApplicationFactoryRules, At4dxBindingRow, BindingIssue, FieldSetInclusionIssue, FieldSetInclusionIssueRule, FieldSetInclusionRuleInfo, RawFieldSetInclusionRecord, WritableBindingType } from '../applicationFactoryCli';
import type {
    MalformedPlatformEventSubscriptionRecord,
    MatcherRule,
    PlatformEventSubscriptionIssue,
    PlatformEventSubscriptionIssueRule,
    PlatformEventSubscriptionRuleInfo,
    RawPlatformEventSubscriptionRecord,
} from '../platformEventCli';

/** Which explorer the tab strip has active — see docs/design/0016 and, for `'platformEvents'`, docs/design/0018. Part of `PanelState`/`InitialState`, not client-side state, so a write-triggered re-render doesn't bounce the user back to the Domain Process tab. */
export type ExplorerKey = 'domainProcess' | 'applicationFactory' | 'platformEvents';

/** Which Application Factory sub-tab (SObject Bindings vs. Service Bindings) is showing — see docs/design/0017. Part of `PanelState`/`InitialState` for the same reason `ExplorerKey` is: a host-triggered re-render fully remounts the webview (docs/design/0011), so a purely client-side `$state` default would silently reset to SObject Bindings on every rescan/write instead of staying on whichever sub-tab the user actually picked. */
export type ApplicationFactoryTab = 'sobject' | 'service';

export type ApplicationFactoryData = {
    rows: At4dxBindingRow[];
    issues: BindingIssue[];
    rules: ApplicationFactoryRules;
    /** `ENTITY_DEFINITION_STANDARD_OBJECTS`, sorted — see `BindingSObjectField.svelte`. */
    standardObjects: string[];
    /** `SelectorConfig_FieldSetInclusion__mdt` records — see docs/design/0017's Stage 4. */
    fieldSetInclusions: RawFieldSetInclusionRecord[];
    fieldSetInclusionIssues: FieldSetInclusionIssue[];
    fieldSetInclusionRules: Record<FieldSetInclusionIssueRule, FieldSetInclusionRuleInfo>;
};

/** Platform Event Distributor subscriptions (`PlatformEvents_Subscription__mdt`) — see docs/design/0018. */
export type PlatformEventsData = {
    records: RawPlatformEventSubscriptionRecord[];
    malformed: MalformedPlatformEventSubscriptionRecord[];
    issues: PlatformEventSubscriptionIssue[];
    rules: Record<PlatformEventSubscriptionIssueRule, PlatformEventSubscriptionRuleInfo>;
};

/** One explorer's own slice of panel state — mirrors `at4dxExplorerPanel.ts`'s `ExplorerState<T>`. */
export type ExplorerViewState<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'empty' } | ({ kind: 'data' } & T);

/** What `main.ts` reads off `window.__INITIAL_STATE__` — the webview-side mirror of `PanelState`. */
export type InitialState = {
    active: ExplorerKey;
    domainProcess: ExplorerViewState<{
        rows: DomainProcessBindingRow[];
        issues: DomainProcessBindingIssue[];
        rules: DomainProcessBindingRules;
    }>;
    applicationFactory: ExplorerViewState<ApplicationFactoryData>;
    /** Platform Event Distributor subscriptions — see docs/design/0018. */
    platformEvents: ExplorerViewState<PlatformEventsData>;
    /** Which Application Factory sub-tab was last selected — defaults to `'sobject'` when absent (a fresh panel, before either sub-tab has ever been explicitly chosen). See `ApplicationFactoryTab`. */
    applicationFactoryTab?: ApplicationFactoryTab;
    /**
     * Both explorers read the same `BindingSource` (see docs/design/0016's "one panel, not two"
     * decision), known as soon as `extension.ts`'s `pickBindingSource` resolves — before either
     * explorer has actually scanned anything, hence optional here rather than nested under `kind: 'data'`.
     */
    isLocalScan?: boolean;
    /** A short display form of the scan's `BindingSource` — an org username, or a workspace-relative source path — shown in the explorer tab strip. See docs/design/0014. */
    sourceLabel?: string;
    /**
     * The outcome of the most recent `submitSequenceBatch` — present only on the one render immediately
     * following it (see `at4dxExplorerPanel.ts`'s `render`), so `SObjectBindingsSheet.svelte` can report
     * what happened without it lingering on a later, unrelated re-render. See docs/design/0017's Stage 3.
     */
    lastBatchResult?: SequenceBatchResult;
};

/** One `UnitOfWork` binding's new `BindingSequence__c`, as the SObject Bindings sheet's "Save commit order" bar posts it. Mirrors `at4dxExplorerPanel.ts`'s own `SequenceBatchUpdate`. */
export type SequenceBatchUpdate = { developerName: string; sobject: string; sequence: number };

/** How many of a `submitSequenceBatch`'s pending moves actually saved (of how many were staged), and, if it stopped early, which SObject failed and why. Mirrors `at4dxExplorerPanel.ts`'s own `SequenceBatchResult`. */
export type SequenceBatchResult = { savedCount: number; totalCount: number; failed?: { sobject: string; message: string } };

/**
 * The create/edit form's field values as posted to the host on submit — see docs/design/0009. Mirrors
 * `at4dxExplorerPanel.ts`'s own `BindingFormPayload`; kept as an independent definition rather
 * than a shared import since the two sides of a `postMessage` boundary have no static link to each
 * other regardless (this shape was never shared before this rewrite either — see 0009's `CLIENT_SCRIPT`).
 */
export type BindingFormPayload = {
    developerName: string;
    label: string;
    sobject: string;
    sobjectAlternate: boolean;
    processContext: ProcessContext;
    triggerOperation?: TriggerOperation;
    domainMethodToken?: string;
    type: DomainProcessType;
    classToInject: string;
    order: number;
    isActive: boolean;
    executeAsynchronous: boolean;
    logicalInverse: boolean;
    preventRecursive: boolean;
    description: string;
};

/**
 * `ApplicationFactoryForm`'s field values as posted on submit (stage 2 Service/Selector/Domain, stage 3
 * UnitOfWork — see docs/design/0016). Fields vary by `bindingType` — the form builds this object from a
 * per-type whitelist rather than sending whatever every field happens to hold, so a stale value left
 * over from switching the segmented control never reaches the host (`to`/`priority` are meaningless for
 * UnitOfWork, `sequence` is meaningless for everything else). Mirrors `at4dxExplorerPanel.ts`'s own
 * `ApplicationFactoryFormPayload`.
 */
export type ApplicationFactoryFormPayload = {
    bindingType: WritableBindingType;
    developerName: string;
    label?: string;
    /** Required for Service/Selector/Domain; never sent for UnitOfWork, which has no `To__c` field. */
    to?: string;
    bindingInterface?: string;
    sobject?: string;
    sobjectAlternate?: boolean;
    priority?: number;
    /** UnitOfWork only — commit order. */
    sequence?: number;
};

/**
 * The Selector drawer's "add a field set" / "✕ remove" field values as posted on submit (stage 4 — see
 * docs/design/0017). Create needs `sobject`/`fieldsetName`; update (the "✕ remove" action, which sets
 * `isActive: false` rather than deleting — the library has no delete) only ever needs `isActive`. Mirrors
 * `at4dxExplorerPanel.ts`'s own `FieldSetInclusionFormPayload`.
 */
export type FieldSetInclusionFormPayload = {
    developerName: string;
    sobject?: string;
    sobjectAlternate?: boolean;
    fieldsetName?: string;
    isActive?: boolean;
};

/** What `ApplicationFactoryForm` can be opened with — either the toolbar's current selection (create, effectively empty) or a full `At4dxBindingRow` (edit). Every field optional since a create prefill supplies none of them. */
export type ApplicationFactoryFormInitial = Partial<{
    bindingType: WritableBindingType;
    developerName: string;
    label: string;
    to: string;
    bindingInterface: string;
    sobject: string;
    sobjectAlternate: boolean;
    priority: number;
    sequence: number;
}>;

/**
 * `PlatformEventForm`'s field values as posted on submit (docs/design/0018) — `developerName`/`eventBus`/
 * `consumer`/`matcherRule` are always sent; `eventCategory`/`event` are sent only when the selected
 * matcher rule dereferences them (see `lib/platformEventView.ts`'s `MATCHER_RULE_REQUIRED_FIELDS`).
 */
export type PlatformEventFormPayload = {
    developerName: string;
    label?: string;
    eventBus: string;
    consumer: string;
    matcherRule: MatcherRule;
    eventCategory?: string;
    event?: string;
    executeSynchronous?: boolean;
};

/** What `PlatformEventForm` can be opened with — either the toolbar's "+ New Subscription" (create, empty) or a full `RawPlatformEventSubscriptionRecord` (edit). Every field optional since a create prefill supplies none of them. */
export type PlatformEventFormInitial = Partial<{
    developerName: string;
    label: string;
    eventBus: string;
    consumer: string;
    matcherRule: MatcherRule;
    eventCategory: string;
    event: string;
    executeSynchronous: boolean;
}>;

export type FamilyKey = 'Created' | 'Updated' | 'Deleted' | 'Undeleted' | 'DomainMethod';

/** What `BindingForm` can be opened with — either the toolbar's current selection (create) or a full `DomainProcessBindingRow` (edit). Every field optional since a create prefill only ever supplies a subset. */
export type BindingFormInitial = Partial<{
    developerName: string;
    label: string;
    sobject: string;
    sobjectField: 'primary' | 'alternate';
    processContext: ProcessContext;
    triggerOperation: TriggerOperation;
    domainMethodToken: string;
    type: DomainProcessType;
    classToInject: string;
    order: number;
    isActive: boolean;
    executeAsynchronous: boolean;
    logicalInverse: boolean;
    preventRecursive: boolean;
    description: string;
}>;

/**
 * A single "+ N issue(s)" entry the way the panel's Issues section renders it, index-tagged so a click
 * can post `{ command: 'openIssue', index }` back against the host's own `state.issues` array. Generic
 * over the issue shape so `IssueEntry.svelte` renders both `DomainProcessBindingIssue` (the default,
 * every existing call site) and the Application Factory explorer's `BindingIssue` — see
 * `lib/applicationFactoryView.ts`.
 */
export type IndexedIssue<I = DomainProcessBindingIssue> = { issue: I; index: number };

/**
 * The minimal shape `IssueEntry.svelte` needs to render an issue, satisfied structurally by
 * `DomainProcessBindingIssue` (`sobject`), `BindingIssue` (`key`), and `PlatformEventSubscriptionIssue`
 * (`eventBus`) without any of them needing to change — see docs/design/0016's note on generalizing
 * `bindingView.ts`'s issue helpers, extended for docs/design/0018.
 */
export type IssueLike = {
    severity: 'error' | 'warning';
    rule: string;
    message: string;
    developerName?: string;
    sobject?: string;
    key?: string;
    eventBus?: string;
    source: string;
    filePath?: string;
};
