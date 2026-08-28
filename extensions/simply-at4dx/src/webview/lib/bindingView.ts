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

export type HeaderParts = { sobject: string; verb: string; isDomainMethod: boolean; article: string };

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

/** `'an'` for a vowel-initial SObject name, `'a'` otherwise — imperfect (e.g. `SLA`), but strictly better than the old `a(n)` placeholder. */
function articleFor(sobject: string): string {
    return VOWELS.has(sobject.charAt(0).toUpperCase()) ? 'an' : 'a';
}

export function headerParts(sobject: string, family: FamilyKey): HeaderParts {
    const article = articleFor(sobject);
    if (family === 'DomainMethod') {
        return { sobject, verb: 'executes', isDomainMethod: true, article };
    }
    return { sobject, verb: FAMILY_LABEL[family], isDomainMethod: false, article };
}

export type BindingSection = { title: string; rows: DomainProcessBindingRow[] };

export type SequenceGroup = {
    /** Integer part of the group's orders, or `null` for rows with no usable order. */
    prefix: number | null;
    /** `'10'`, or `'No order'` for the orderless group. */
    label: string;
    /** `'10.1 – 10.3'`, or `'10.1'` when the group holds one row. Empty for the orderless group. */
    range: string;
    /** Composition summary — `'1 criteria gates 2 actions'`. Empty when it would say nothing useful. */
    summary: string;
    rows: DomainProcessBindingRow[];
};

/** How an order reads in the UI. Matches `BindingRow`'s `{row.order}` so a caption's range and its rows never disagree. */
export function formatOrder(order: number): string {
    return String(order);
}

function groupSummary(rows: DomainProcessBindingRow[]): string {
    const criteria = rows.filter((row) => row.type === 'Criteria').length;
    const actions = rows.length - criteria;
    if (criteria > 0 && actions > 0) {
        return `${criteria} criteria ${criteria === 1 ? 'gates' : 'gate'} ${actions} action${actions === 1 ? '' : 's'}`;
    }
    if (actions > 0) {
        return `${actions} action${actions === 1 ? '' : 's'}`;
    }
    if (criteria > 0) {
        return `${criteria} criteria`;
    }
    return '';
}

/**
 * Groups a section's rows by the integer part of `order` — the AT4DX convention where the integer
 * identifies a unit of work and the fraction orders the bindings inside it. See docs/design/0015.
 * Rows with no usable order land in a final `prefix: null` group rather than being merged into `0`.
 */
export function buildSequenceGroups(rows: DomainProcessBindingRow[]): SequenceGroup[] {
    const byPrefix = new Map<number, DomainProcessBindingRow[]>();
    const orderless: DomainProcessBindingRow[] = [];

    for (const row of rows) {
        if (typeof row.order !== 'number' || !Number.isFinite(row.order)) {
            orderless.push(row);
            continue;
        }
        const prefix = Math.trunc(row.order);
        const group = byPrefix.get(prefix) ?? [];
        group.push(row);
        byPrefix.set(prefix, group);
    }

    const groups: SequenceGroup[] = [...byPrefix.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([prefix, groupRows]) => {
            const sorted = [...groupRows].sort((a, b) => a.order - b.order);
            const first = formatOrder(sorted[0].order);
            const last = formatOrder(sorted[sorted.length - 1].order);
            return {
                prefix,
                label: String(prefix),
                range: sorted.length === 1 ? first : `${first} – ${last}`,
                summary: groupSummary(sorted),
                rows: sorted,
            };
        });

    if (orderless.length > 0) {
        groups.push({ prefix: null, label: 'No order', range: '', summary: groupSummary(orderless), rows: orderless });
    }
    return groups;
}

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
