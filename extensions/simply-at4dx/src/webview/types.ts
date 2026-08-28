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

import type { DomainProcessBindingIssue, DomainProcessBindingRow, DomainProcessBindingRules, DomainProcessType, ProcessContext, TriggerOperation } from '../at4dxCli';

/** What `main.ts` reads off `window.__INITIAL_STATE__` — the webview-side mirror of `PanelState`. */
export type InitialState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'empty' }
    | {
          kind: 'data';
          rows: DomainProcessBindingRow[];
          issues: DomainProcessBindingIssue[];
          rules: DomainProcessBindingRules;
          isLocalScan: boolean;
      };

/**
 * The create/edit form's field values as posted to the host on submit — see docs/design/0009. Mirrors
 * `domainProcessBindingPanel.ts`'s own `BindingFormPayload`; kept as an independent definition rather
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

/** A single "+ N issue(s)" entry the way the panel's Issues section renders it, index-tagged so a click can post `{ command: 'openIssue', index }` back against the host's own `state.issues` array. */
export type IndexedIssue = { issue: DomainProcessBindingIssue; index: number };
