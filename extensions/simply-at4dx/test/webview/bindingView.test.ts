import { describe, expect, it } from 'vitest';
import {
    availableFamilies,
    buildSections,
    buildSequenceGroups,
    developerNameValid,
    familyVerbForOperation,
    headerParts,
    issuesByRecord,
    partitionIssues,
    recordKey,
    ruleTitle,
    sectionTitle,
} from '../../src/webview/lib/bindingView';
import type { DomainProcessBindingIssue, DomainProcessBindingRow, DomainProcessBindingRules } from '../../src/webview/types';

function row(overrides: Partial<DomainProcessBindingRow> = {}): DomainProcessBindingRow {
    return {
        developerName: 'Account_Before_Insert_Test',
        source: 'local',
        label: 'Test',
        sobject: 'Account',
        sobjectField: 'primary',
        processContext: 'TriggerExecution',
        triggerOperation: 'Before_Insert',
        type: 'Action',
        classToInject: 'SomeClass',
        order: 10,
        isActive: true,
        executeAsynchronous: false,
        logicalInverse: false,
        preventRecursive: false,
        description: '',
        orderCollision: false,
        ...overrides,
    } as DomainProcessBindingRow;
}

function issue(overrides: Partial<DomainProcessBindingIssue> = {}): DomainProcessBindingIssue {
    return {
        rule: 'order-collision',
        severity: 'error',
        scope: 'record',
        source: 'local',
        message: 'Two active bindings share the same order.',
        ...overrides,
    } as DomainProcessBindingIssue;
}

describe('sectionTitle', () => {
    it('maps every trigger operation to its display title', () => {
        expect(sectionTitle('Before_Insert')).toBe('Record Before Save');
        expect(sectionTitle('After_Insert')).toBe('Record After Save');
        expect(sectionTitle('Before_Update')).toBe('Record Before Save');
        expect(sectionTitle('After_Update')).toBe('Record After Save');
        expect(sectionTitle('Before_Delete')).toBe('Record Before Delete');
        expect(sectionTitle('After_Delete')).toBe('Record After Delete');
        expect(sectionTitle('After_Undelete')).toBe('Record After Undelete');
    });
});

describe('familyVerbForOperation', () => {
    it('maps every trigger operation to its family-style verb', () => {
        expect(familyVerbForOperation('Before_Insert')).toBe('Created');
        expect(familyVerbForOperation('After_Insert')).toBe('Created');
        expect(familyVerbForOperation('Before_Update')).toBe('Updated');
        expect(familyVerbForOperation('After_Update')).toBe('Updated');
        expect(familyVerbForOperation('Before_Delete')).toBe('Deleted');
        expect(familyVerbForOperation('After_Delete')).toBe('Deleted');
        expect(familyVerbForOperation('After_Undelete')).toBe('Undeleted');
    });
});

describe('headerParts', () => {
    it('describes a trigger-event family', () => {
        expect(headerParts('Account', 'Created')).toEqual({ sobject: 'Account', verb: 'Created', isDomainMethod: false, article: 'an' });
    });

    it('describes the domain method family', () => {
        expect(headerParts('Account', 'DomainMethod')).toEqual({ sobject: 'Account', verb: 'executes', isDomainMethod: true, article: 'an' });
    });

    it('uses "a" for a consonant-initial SObject', () => {
        expect(headerParts('Contact', 'Created').article).toBe('a');
    });

    it('uses "an" for a vowel-initial SObject', () => {
        expect(headerParts('Opportunity', 'Created').article).toBe('an');
    });
});

describe('buildSections', () => {
    it('splits Created bindings into Before/After Save sections, dropping empty ones', () => {
        const rows = [row({ triggerOperation: 'Before_Insert', developerName: 'A' }), row({ triggerOperation: 'After_Insert', developerName: 'B' })];
        const sections = buildSections('Created', rows);

        expect(sections.map((s) => s.title)).toEqual(['Record Before Save', 'Record After Save']);
        expect(sections[0].rows.map((r) => r.developerName)).toEqual(['A']);
    });

    it('omits a side of the family with no rows', () => {
        const rows = [row({ triggerOperation: 'Before_Insert' })];
        expect(buildSections('Created', rows).map((s) => s.title)).toEqual(['Record Before Save']);
    });

    it('groups Domain Method Execution rows by token', () => {
        const rows = [
            row({ processContext: 'DomainMethodExecution', domainMethodToken: 'onValidate', developerName: 'A', triggerOperation: undefined }),
            row({ processContext: 'DomainMethodExecution', domainMethodToken: 'onValidate', developerName: 'B', triggerOperation: undefined }),
            row({ processContext: 'DomainMethodExecution', developerName: 'C', triggerOperation: undefined }),
        ];
        const sections = buildSections('DomainMethod', rows);

        expect(sections).toEqual([
            { title: 'onValidate', rows: [rows[0], rows[1]] },
            { title: '(no token)', rows: [rows[2]] },
        ]);
    });
});

describe('availableFamilies', () => {
    it('reports Created for Before/After Insert rows', () => {
        expect(availableFamilies([row({ triggerOperation: 'Before_Insert' })])).toEqual(new Set(['Created']));
    });

    it('reports DomainMethod for a DomainMethodExecution row regardless of triggerOperation', () => {
        expect(availableFamilies([row({ processContext: 'DomainMethodExecution', triggerOperation: undefined })])).toEqual(new Set(['DomainMethod']));
    });

    it('collects every distinct family present', () => {
        const families = availableFamilies([
            row({ triggerOperation: 'Before_Insert' }),
            row({ triggerOperation: 'After_Delete' }),
            row({ triggerOperation: 'After_Undelete' }),
        ]);
        expect(families).toEqual(new Set(['Created', 'Deleted', 'Undeleted']));
    });
});

describe('recordKey / issuesByRecord', () => {
    it('joins on (developerName, source) and ignores scope', () => {
        const issues = [issue({ developerName: 'A', source: 'local', scope: 'scan' }), issue({ developerName: 'B', source: 'org' })];
        const byRecord = issuesByRecord(issues);

        expect(byRecord.get(recordKey('A', 'local'))?.map((e) => e.issue)).toEqual([issues[0]]);
        expect(byRecord.get(recordKey('B', 'org'))?.map((e) => e.issue)).toEqual([issues[1]]);
    });

    it('drops issues with no developerName (nothing to badge)', () => {
        const issues = [issue({ developerName: undefined })];
        expect(issuesByRecord(issues).size).toBe(0);
    });

    it('preserves the original array index on each entry', () => {
        const issues = [issue({ developerName: 'A' }), issue({ developerName: 'B' })];
        const byRecord = issuesByRecord(issues);
        expect(byRecord.get(recordKey('B', 'local'))?.[0].index).toBe(1);
    });
});

describe('ruleTitle', () => {
    const rules = { 'order-collision': { title: 'Order collision', summary: '' } } as unknown as DomainProcessBindingRules;

    it('resolves a known rule to its title', () => {
        expect(ruleTitle(rules, 'order-collision')).toBe('Order collision');
    });

    it('falls back to the raw slug for an unknown rule', () => {
        expect(ruleTitle(rules, 'missing-sobject-reference')).toBe('missing-sobject-reference');
    });
});

describe('partitionIssues', () => {
    it('puts record-scoped issues for the selected SObject in view, everything else elsewhere', () => {
        const issues = [
            issue({ scope: 'record', sobject: 'Account' }),
            issue({ scope: 'record', sobject: 'Contact' }),
            issue({ scope: 'scan' }),
        ];
        const { inView, elsewhere } = partitionIssues(issues, 'Account');

        expect(inView.map((e) => e.issue)).toEqual([issues[0]]);
        expect(elsewhere.map((e) => e.issue)).toEqual([issues[1], issues[2]]);
    });
});

describe('buildSequenceGroups', () => {
    it('splits rows into groups by the integer part of order, sorted ascending', () => {
        const rows = [
            row({ developerName: 'A', order: 10.1 }),
            row({ developerName: 'B', order: 10.2 }),
            row({ developerName: 'C', order: 10.3 }),
            row({ developerName: 'D', order: 20.1 }),
            row({ developerName: 'E', order: 20.2 }),
        ];
        const groups = buildSequenceGroups(rows);

        expect(groups.map((g) => g.prefix)).toEqual([10, 20]);
        expect(groups[0].range).toBe('10.1 – 10.3');
        expect(groups[1].range).toBe('20.1 – 20.2');
    });

    it('sorts groups and rows within a group ascending even when input is shuffled', () => {
        const rows = [row({ developerName: 'C', order: 20.1 }), row({ developerName: 'A', order: 10.2 }), row({ developerName: 'B', order: 10.1 })];
        const groups = buildSequenceGroups(rows);

        expect(groups.map((g) => g.prefix)).toEqual([10, 20]);
        expect(groups[0].rows.map((r) => r.developerName)).toEqual(['B', 'A']);
    });

    it('gives a single-row group a bare range, not a repeated one', () => {
        const groups = buildSequenceGroups([row({ order: 10.1 })]);
        expect(groups[0].range).toBe('10.1');
    });

    it('collects rows with no usable order into a trailing "No order" group, not group 0', () => {
        const rows = [row({ developerName: 'A', order: 10.1 }), row({ developerName: 'B', order: NaN }), row({ developerName: 'C', order: undefined })];
        const groups = buildSequenceGroups(rows);

        expect(groups.map((g) => g.label)).toEqual(['10', 'No order']);
        expect(groups[1].prefix).toBeNull();
        expect(groups[1].rows.map((r) => r.developerName)).toEqual(['B', 'C']);
    });

    it('summarizes a mixed group as "N criteria gate(s) M action(s)"', () => {
        const groups = buildSequenceGroups([row({ order: 10.1, type: 'Criteria' }), row({ order: 10.2, type: 'Action' }), row({ order: 10.3, type: 'Action' })]);
        expect(groups[0].summary).toBe('1 criteria gates 2 actions');
    });

    it('summarizes an actions-only group without mentioning criteria', () => {
        const groups = buildSequenceGroups([row({ order: 10.1, type: 'Action' }), row({ order: 10.2, type: 'Action' })]);
        expect(groups[0].summary).toBe('2 actions');
    });

    it('summarizes a criteria-only group as plural "criteria", never "criterias"', () => {
        const groups = buildSequenceGroups([row({ order: 10.1, type: 'Criteria' }), row({ order: 10.2, type: 'Criteria' })]);
        expect(groups[0].summary).toBe('2 criteria');
        expect(groups[0].summary).not.toContain('criterias');
    });
});

describe('developerNameValid', () => {
    it.each(['Account_Before_Insert', 'a', 'A1'])('accepts %s', (value) => {
        expect(developerNameValid(value)).toBe(true);
    });

    it.each(['', '1Account', 'Account__C', 'Account_', 'Account With Space', 'A'.repeat(41)])('rejects %s', (value) => {
        expect(developerNameValid(value)).toBe(false);
    });
});
