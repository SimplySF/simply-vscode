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
export type { ApplicationFactoryRules, At4dxBindingRow, BindingIssue, BindingIssueRule, BindingType } from '../applicationFactoryCli';

import type { DomainProcessBindingIssue, DomainProcessBindingRow, DomainProcessBindingRules, DomainProcessType, ProcessContext, TriggerOperation } from '../at4dxCli';
import type { ApplicationFactoryRules, At4dxBindingRow, BindingIssue } from '../applicationFactoryCli';

/** Which explorer the tab strip has active — see docs/design/0016. Part of `PanelState`/`InitialState`, not client-side state, so a write-triggered re-render doesn't bounce the user back to the Domain Process tab. */
export type ExplorerKey = 'domainProcess' | 'applicationFactory';

export type ApplicationFactoryData = {
    rows: At4dxBindingRow[];
    issues: BindingIssue[];
    rules: ApplicationFactoryRules;
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
    /**
     * Both explorers read the same `BindingSource` (see docs/design/0016's "one panel, not two"
     * decision), known as soon as `extension.ts`'s `pickBindingSource` resolves — before either
     * explorer has actually scanned anything, hence optional here rather than nested under `kind: 'data'`.
     */
    isLocalScan?: boolean;
    /** A short display form of the scan's `BindingSource` — an org username, or a workspace-relative source path — shown in the explorer tab strip. See docs/design/0014. */
    sourceLabel?: string;
};

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
 * The minimal shape `IssueEntry.svelte` needs to render an issue, satisfied structurally by both
 * `DomainProcessBindingIssue` (`sobject`) and `BindingIssue` (`key`) without either one needing to
 * change — see docs/design/0016's note on generalizing `bindingView.ts`'s issue helpers.
 */
export type IssueLike = {
    severity: 'error' | 'warning';
    rule: string;
    message: string;
    developerName?: string;
    sobject?: string;
    key?: string;
    source: string;
    filePath?: string;
};
