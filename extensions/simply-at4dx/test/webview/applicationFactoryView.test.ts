import { describe, expect, it } from 'vitest';
import {
    applicationFactoryRowToFormInitial,
    buildApplicationFactorySections,
    buildUnitOfWorkRows,
    commitPositions,
    groupsByKey,
    isCustomObjectApiName,
    ordinal,
    partitionBySeverity,
    previewCommitPosition,
} from '../../src/webview/lib/applicationFactoryView';
import type { At4dxBindingRow, BindingIssue } from '../../src/webview/types';

function row(overrides: Partial<At4dxBindingRow> = {}): At4dxBindingRow {
    return {
        bindingType: 'Service',
        developerName: 'PricingServiceBinding',
        label: 'Pricing Service',
        key: 'IPricingService',
        to: 'PricingServiceImpl',
        source: 'local',
        effective: true,
        ...overrides,
    } as At4dxBindingRow;
}

describe('buildApplicationFactorySections', () => {
    it('returns sections in Service, Selector, Domain order regardless of scan order, and skips UnitOfWork', () => {
        const rows = [
            row({ bindingType: 'Domain', developerName: 'D', key: 'Account', to: 'Accounts' }),
            row({ bindingType: 'UnitOfWork', developerName: 'U', key: 'Account', to: undefined, sequence: 10 }),
            row({ bindingType: 'Service', developerName: 'S', key: 'IPricingService', to: 'PricingServiceImpl' }),
        ];

        const sections = buildApplicationFactorySections(rows);

        expect(sections.map((s) => s.bindingType)).toEqual(['Service', 'Domain']);
    });

    it('produces no section for a binding type with no records', () => {
        const sections = buildApplicationFactorySections([row({ bindingType: 'Service' })]);

        expect(sections.map((s) => s.bindingType)).toEqual(['Service']);
    });

    it('Service section has Interface as its key header and shows priority; Domain has SObject and hides it', () => {
        const sections = buildApplicationFactorySections([
            row({ bindingType: 'Service' }),
            row({ bindingType: 'Domain', developerName: 'D', key: 'Account', to: 'Accounts' }),
        ]);

        const service = sections.find((s) => s.bindingType === 'Service')!;
        const domain = sections.find((s) => s.bindingType === 'Domain')!;
        expect(service.keyHeader).toBe('Interface');
        expect(service.showPriority).toBe(true);
        expect(domain.keyHeader).toBe('SObject');
        expect(domain.showPriority).toBe(false);
    });

    it('a single row for a key is effective, never a tie', () => {
        const sections = buildApplicationFactorySections([row({ priority: 10, effective: true })]);

        expect(sections[0].rows[0].resolution).toEqual({ kind: 'effective' });
    });

    it('marks a non-winning row of a unique-max-priority group as shadowed', () => {
        const rows = [
            row({ developerName: 'A', priority: 20, effective: true }),
            row({ developerName: 'B', priority: 10, effective: false }),
        ];

        const [section] = buildApplicationFactorySections(rows);

        expect(section.rows.find((r) => r.developerName === 'A')!.resolution).toEqual({ kind: 'effective' });
        expect(section.rows.find((r) => r.developerName === 'B')!.resolution).toEqual({ kind: 'shadowed' });
    });

    it('treats priority: 0 as beating priority: undefined — the undefined-as-zero bug', () => {
        const rows = [
            row({ developerName: 'A', priority: 0, effective: true }),
            row({ developerName: 'B', priority: undefined, effective: false }),
        ];

        const [section] = buildApplicationFactorySections(rows);

        expect(section.rows.find((r) => r.developerName === 'A')!.resolution).toEqual({ kind: 'effective' });
        expect(section.rows.find((r) => r.developerName === 'B')!.resolution).toEqual({ kind: 'shadowed' });
    });

    it('a tie of three rows yields one tie-winner and two tie-other', () => {
        const rows = [
            row({ developerName: 'A', priority: 10, effective: false }),
            row({ developerName: 'B', priority: 10, effective: true }),
            row({ developerName: 'C', priority: 10, effective: false }),
        ];

        const [section] = buildApplicationFactorySections(rows);

        const kinds = section.rows.map((r) => r.resolution.kind).sort();
        expect(kinds).toEqual(['tie-other', 'tie-other', 'tie-winner']);
    });

    it('Domain rows sharing a key are ambiguous, not shadowed/effective', () => {
        const rows = [
            row({ bindingType: 'Domain', developerName: 'A', key: 'Account', to: 'AccountsA', ambiguous: true, effective: true }),
            row({ bindingType: 'Domain', developerName: 'B', key: 'Account', to: 'AccountsB', ambiguous: true, effective: false }),
        ];

        const [section] = buildApplicationFactorySections(rows);

        expect(section.rows.every((r) => r.resolution.kind === 'ambiguous')).toBe(true);
    });

    it('a unique Domain key is effective, not ambiguous', () => {
        const [section] = buildApplicationFactorySections([row({ bindingType: 'Domain', key: 'Account', to: 'Accounts', effective: true })]);

        expect(section.rows[0].resolution).toEqual({ kind: 'effective' });
    });
});

describe('groupsByKey', () => {
    it('groups consecutive rows sharing a key, keeping separate keys as separate groups even if repeated later', () => {
        const rows = [row({ developerName: 'A', key: 'X' }), row({ developerName: 'B', key: 'X' }), row({ developerName: 'C', key: 'Y' })];

        const groups = groupsByKey(rows);

        expect(groups).toHaveLength(2);
        expect(groups[0]).toEqual({ key: 'X', rows: [rows[0], rows[1]] });
        expect(groups[1]).toEqual({ key: 'Y', rows: [rows[2]] });
    });
});

describe('ordinal', () => {
    it('formats 1st/2nd/3rd/4th and the 11th-13th exception', () => {
        expect(ordinal(1)).toBe('1st');
        expect(ordinal(2)).toBe('2nd');
        expect(ordinal(3)).toBe('3rd');
        expect(ordinal(4)).toBe('4th');
        expect(ordinal(11)).toBe('11th');
        expect(ordinal(12)).toBe('12th');
        expect(ordinal(13)).toBe('13th');
        expect(ordinal(21)).toBe('21st');
    });
});

describe('commitPositions / buildUnitOfWorkRows', () => {
    function uowRow(developerName: string, sequence?: number): At4dxBindingRow {
        return row({ bindingType: 'UnitOfWork', developerName, key: developerName, to: undefined, sequence, effective: true });
    }

    it('[10, 20, 30] maps to 1st, 2nd, 3rd', () => {
        const rows = [uowRow('A', 10), uowRow('B', 20), uowRow('C', 30)];

        const positions = commitPositions(rows);

        expect(positions.get('A local')).toBe('1st');
        expect(positions.get('B local')).toBe('2nd');
        expect(positions.get('C local')).toBe('3rd');
    });

    it('[10, 20, 20, 30] maps to 1st, 2nd or 3rd (twice), 4th — rank, not index', () => {
        const rows = [uowRow('A', 10), uowRow('B', 20), uowRow('C', 20), uowRow('D', 30)];

        const positions = commitPositions(rows);

        expect(positions.get('A local')).toBe('1st');
        expect(positions.get('B local')).toBe('2nd or 3rd');
        expect(positions.get('C local')).toBe('2nd or 3rd');
        expect(positions.get('D local')).toBe('4th');
    });

    it('gives a row with no sequence no entry at all — never inventing a position', () => {
        const rows = [uowRow('A', 10), uowRow('B', undefined)];

        const positions = commitPositions(rows);

        expect(positions.has('B local')).toBe(false);
    });

    it('buildUnitOfWorkRows only includes UnitOfWork rows and annotates commitPosition', () => {
        const rows = [row({ bindingType: 'Service' }), uowRow('A', 10), uowRow('B', 20)];

        const uowRows = buildUnitOfWorkRows(rows);

        expect(uowRows).toHaveLength(2);
        expect(uowRows.find((r) => r.developerName === 'A')!.commitPosition).toBe('1st');
        expect(uowRows.find((r) => r.developerName === 'B')!.commitPosition).toBe('2nd');
    });
});

describe('isCustomObjectApiName', () => {
    it('is true for any name containing "__", false otherwise', () => {
        expect(isCustomObjectApiName('Widget__c')).toBe(true);
        expect(isCustomObjectApiName('myns__Widget__c')).toBe(true);
        expect(isCustomObjectApiName('Account')).toBe(false);
        expect(isCustomObjectApiName('Task')).toBe(false);
    });
});

describe('applicationFactoryRowToFormInitial', () => {
    it('maps a Service row\'s key to bindingInterface', () => {
        const initial = applicationFactoryRowToFormInitial(row({ bindingType: 'Service', key: 'IPricingService', to: 'PricingServiceImpl', priority: 10 }));

        expect(initial).toMatchObject({ bindingType: 'Service', bindingInterface: 'IPricingService', to: 'PricingServiceImpl', priority: 10 });
        expect(initial.sobject).toBeUndefined();
    });

    it('maps a Selector row\'s key/keyField to sobject/sobjectAlternate', () => {
        const initial = applicationFactoryRowToFormInitial(row({ bindingType: 'Selector', key: 'Task', keyField: 'alternate', to: 'TasksSelector' }));

        expect(initial).toMatchObject({ bindingType: 'Selector', sobject: 'Task', sobjectAlternate: true, to: 'TasksSelector' });
        expect(initial.bindingInterface).toBeUndefined();
    });

    it('a primary-field SObject reference maps to sobjectAlternate: false', () => {
        const initial = applicationFactoryRowToFormInitial(row({ bindingType: 'Domain', key: 'Account', keyField: 'primary', to: 'Accounts' }));

        expect(initial.sobjectAlternate).toBe(false);
    });

    it('maps a UnitOfWork row\'s key/sequence to sobject/sequence, with no to or priority', () => {
        const initial = applicationFactoryRowToFormInitial(row({ bindingType: 'UnitOfWork', key: 'Account', keyField: 'primary', to: undefined, sequence: 10 }));

        expect(initial).toMatchObject({ bindingType: 'UnitOfWork', sobject: 'Account', sobjectAlternate: false, sequence: 10 });
        expect(initial.to).toBeUndefined();
        expect(initial.priority).toBeUndefined();
    });
});

describe('previewCommitPosition', () => {
    function uowRow(developerName: string, sequence?: number): At4dxBindingRow {
        return row({ bindingType: 'UnitOfWork', developerName, key: developerName, to: undefined, sequence, effective: true });
    }

    it('previews a new record landing after two existing ones', () => {
        const existing = [uowRow('A', 10), uowRow('B', 20)];

        const preview = previewCommitPosition(existing, undefined, 30);

        expect(preview).toEqual({ label: '3rd', total: 3 });
    });

    it('previews an unsequenced new record as unordered', () => {
        const existing = [uowRow('A', 10)];

        const preview = previewCommitPosition(existing, undefined, undefined);

        expect(preview.label).toBe('unordered — no sequence set');
        expect(preview.total).toBe(2);
    });

    it('excludes the record being edited from the "existing" comparison set', () => {
        const existing = [uowRow('A', 10), uowRow('B', 20)];

        // Editing A down to sequence 30 should not count A against itself.
        const preview = previewCommitPosition(existing, 'A', 30);

        expect(preview).toEqual({ label: '2nd', total: 2 });
    });

    it('previews a tie when the entered sequence matches an existing one', () => {
        const existing = [uowRow('A', 10)];

        const preview = previewCommitPosition(existing, undefined, 10);

        expect(preview.label).toBe('1st or 2nd');
    });
});

describe('partitionBySeverity', () => {
    function issue(overrides: Partial<BindingIssue> = {}): BindingIssue {
        return { severity: 'error', rule: 'duplicate-to', scope: 'scan', message: 'x', bindingType: 'Service', source: 'local', ...overrides } as BindingIssue;
    }

    it('splits errors and warnings, keeping the index against the original array', () => {
        const issues = [issue({ severity: 'error' }), issue({ severity: 'warning', rule: 'sequence-collision' }), issue({ severity: 'error', rule: 'duplicate-developer-name' })];

        const { errors, warnings } = partitionBySeverity(issues);

        expect(errors.map((e) => e.index)).toEqual([0, 2]);
        expect(warnings.map((w) => w.index)).toEqual([1]);
    });
});
