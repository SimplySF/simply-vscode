/**
 * Pure, DOM-free logic ported from the old `CLIENT_SCRIPT` template literal — grouping/formatting
 * rules the components render from. Kept separate from the `.svelte` files specifically so it can be
 * unit-tested with plain Vitest (`environment: 'node'`), not just via `@testing-library/svelte`'s
 * jsdom-based component tests. See docs/design/0011.
 */
import type { DomainProcessBindingIssue, DomainProcessBindingRow, DomainProcessBindingRules, FamilyKey, IndexedIssue, TriggerOperation } from '../types';

export const FAMILY_ITEMS: { value: FamilyKey; label: string }[] = [
    { value: 'Created', label: 'Created' },
    { value: 'Updated', label: 'Updated' },
    { value: 'Deleted', label: 'Deleted' },
    { value: 'Undeleted', label: 'Undeleted' },
    { value: 'DomainMethod', label: 'Domain Method Execution' },
];

const FAMILY_LABEL: Record<'Created' | 'Updated' | 'Deleted' | 'Undeleted', string> = {
    Created: 'Created',
    Updated: 'Updated',
    Deleted: 'Deleted',
    Undeleted: 'Undeleted',
};

const TRIGGER_OPS_BY_FAMILY: Record<FamilyKey, { before?: TriggerOperation; after?: TriggerOperation }> = {
    Created: { before: 'Before_Insert', after: 'After_Insert' },
    Updated: { before: 'Before_Update', after: 'After_Update' },
    Deleted: { before: 'Before_Delete', after: 'After_Delete' },
    Undeleted: { after: 'After_Undelete' },
    DomainMethod: {},
};

export const TRIGGER_OPERATIONS: TriggerOperation[] = [
    'Before_Insert',
    'After_Insert',
    'Before_Update',
    'After_Update',
    'Before_Delete',
    'After_Delete',
    'After_Undelete',
];

export const TRIGGER_OPERATION_LABELS: Record<TriggerOperation, string> = {
    Before_Insert: 'Before Insert',
    After_Insert: 'After Insert',
    Before_Update: 'Before Update',
    After_Update: 'After Update',
    Before_Delete: 'Before Delete',
    After_Delete: 'After Delete',
    After_Undelete: 'After Undelete',
};

const FAMILY_VERB_BY_OPERATION: Record<TriggerOperation, string> = {
    Before_Insert: 'Created',
    After_Insert: 'Created',
    Before_Update: 'Updated',
    After_Update: 'Updated',
    Before_Delete: 'Deleted',
    After_Delete: 'Deleted',
    After_Undelete: 'Undeleted',
};

/** The family-style verb (`Created`/`Updated`/...) a `TriggerOperation` belongs to — used by the create/edit form's live "resulting binding" preview sentence. */
export function familyVerbForOperation(operation: TriggerOperation): string {
    return FAMILY_VERB_BY_OPERATION[operation];
}

export function sectionTitle(operation: TriggerOperation): string {
    switch (operation) {
        case 'Before_Insert':
        case 'Before_Update':
            return 'Record Before Save';
        case 'After_Insert':
        case 'After_Update':
            return 'Record After Save';
        case 'Before_Delete':
            return 'Record Before Delete';
        case 'After_Delete':
            return 'Record After Delete';
        case 'After_Undelete':
            return 'Record After Undelete';
        default:
            return operation;
    }
}

export type HeaderParts = { sobject: string; verb: string; isDomainMethod: boolean };

export function headerParts(sobject: string, family: FamilyKey): HeaderParts {
    if (family === 'DomainMethod') {
        return { sobject, verb: 'executes', isDomainMethod: true };
    }
    return { sobject, verb: FAMILY_LABEL[family], isDomainMethod: false };
}

export type BindingSection = { title: string; rows: DomainProcessBindingRow[] };

/** Groups `rows` (already filtered to one SObject) into the titled sections the panel renders for `family`. */
export function buildSections(family: FamilyKey, rows: DomainProcessBindingRow[]): BindingSection[] {
    if (family === 'DomainMethod') {
        const byToken = new Map<string, DomainProcessBindingRow[]>();
        for (const row of rows) {
            const token = row.domainMethodToken || '(no token)';
            const group = byToken.get(token) ?? [];
            group.push(row);
            byToken.set(token, group);
        }
        return [...byToken.entries()].map(([token, groupRows]) => ({ title: token, rows: groupRows }));
    }

    const ops = TRIGGER_OPS_BY_FAMILY[family];
    const sections: BindingSection[] = [];
    if (ops.before) {
        const before = ops.before;
        sections.push({ title: sectionTitle(before), rows: rows.filter((row) => row.triggerOperation === before) });
    }
    if (ops.after) {
        const after = ops.after;
        sections.push({ title: sectionTitle(after), rows: rows.filter((row) => row.triggerOperation === after) });
    }
    return sections.filter((section) => section.rows.length > 0);
}

/** Which `FamilyKey`s have at least one binding among `sobjectRows` — drives the Trigger Event dropdown's options. */
export function availableFamilies(sobjectRows: DomainProcessBindingRow[]): Set<FamilyKey> {
    const available = new Set<FamilyKey>();
    for (const row of sobjectRows) {
        if (row.processContext === 'DomainMethodExecution') {
            available.add('DomainMethod');
            continue;
        }
        switch (row.triggerOperation) {
            case 'Before_Insert':
            case 'After_Insert':
                available.add('Created');
                break;
            case 'Before_Update':
            case 'After_Update':
                available.add('Updated');
                break;
            case 'Before_Delete':
            case 'After_Delete':
                available.add('Deleted');
                break;
            case 'After_Undelete':
                available.add('Undeleted');
                break;
        }
    }
    return available;
}

export function recordKey(developerName: string, source: string): string {
    return `${developerName} ${source}`;
}

/** Every issue that names a record, indexed by `(developerName, source)` — see docs/design/0007 on why badges join on identity regardless of `scope`. */
export function issuesByRecord(issues: DomainProcessBindingIssue[]): Map<string, IndexedIssue[]> {
    const map = new Map<string, IndexedIssue[]>();
    issues.forEach((issue, index) => {
        if (!issue.developerName) {
            return;
        }
        const key = recordKey(issue.developerName, issue.source);
        const list = map.get(key) ?? [];
        list.push({ issue, index });
        map.set(key, list);
    });
    return map;
}

export function ruleTitle(rules: DomainProcessBindingRules, rule: DomainProcessBindingIssue['rule']): string {
    return rules[rule]?.title ?? rule;
}

/** Partitions the whole scan's issues against the currently selected SObject — docs/design/0007's "two different joins" section. */
export function partitionIssues(issues: DomainProcessBindingIssue[], sobject: string): { inView: IndexedIssue[]; elsewhere: IndexedIssue[] } {
    const indexed = issues.map((issue, index) => ({ issue, index }));
    const inView = indexed.filter((entry) => entry.issue.scope === 'record' && entry.issue.sobject === sobject);
    const elsewhere = indexed.filter((entry) => !(entry.issue.scope === 'record' && entry.issue.sobject === sobject));
    return { inView, elsewhere };
}

/**
 * `DeveloperName__c` validation, mirrored from the library's own rule (0009). Written without a regex
 * literal deliberately — see docs/design/0009's post-implementation note on the "missing /" webview-load
 * failure a regex literal caused when this lived inline in a template-literal script; kept as plain
 * character checks here too even though that specific failure mode no longer applies to a real,
 * separately-compiled file, so this stays a direct, easily-diffed port of the original.
 */
export function developerNameValid(value: string): boolean {
    if (!value || value.length > 40) {
        return false;
    }
    const isAsciiLetter = (ch: string) => (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
    const isAsciiLetterOrDigit = (ch: string) => isAsciiLetter(ch) || (ch >= '0' && ch <= '9');
    if (!isAsciiLetter(value.charAt(0))) {
        return false;
    }
    for (let i = 0; i < value.length; i++) {
        const ch = value.charAt(i);
        if (!isAsciiLetterOrDigit(ch) && ch !== '_') {
            return false;
        }
    }
    return value.indexOf('__') === -1 && value.charAt(value.length - 1) !== '_';
}
