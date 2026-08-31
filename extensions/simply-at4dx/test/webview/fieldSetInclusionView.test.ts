import { describe, expect, it } from 'vitest';
import { activeFieldSetInclusionsForSObject, fieldSetCountBySObject, fieldSetCountLabel, suggestFieldSetInclusionDeveloperName } from '../../src/webview/lib/fieldSetInclusionView';
import type { RawFieldSetInclusionRecord } from '../../src/webview/types';

function inclusion(overrides: Partial<RawFieldSetInclusionRecord> = {}): RawFieldSetInclusionRecord {
    return {
        developerName: 'Account_TierFields',
        label: 'Account Tier Fields',
        sobject: 'Account',
        sobjectField: 'primary',
        fieldsetName: 'AccountTierFields',
        isActive: true,
        source: 'local',
        ...overrides,
    } as RawFieldSetInclusionRecord;
}

describe('activeFieldSetInclusionsForSObject', () => {
    it('returns only active records for the given SObject', () => {
        const records = [
            inclusion({ developerName: 'A', sobject: 'Account', isActive: true }),
            inclusion({ developerName: 'B', sobject: 'Account', isActive: false }),
            inclusion({ developerName: 'C', sobject: 'Contact', isActive: true }),
        ];

        expect(activeFieldSetInclusionsForSObject(records, 'Account').map((r) => r.developerName)).toEqual(['A']);
    });

    it('trims the queried SObject before comparing', () => {
        const records = [inclusion({ developerName: 'A', sobject: 'Account' })];
        expect(activeFieldSetInclusionsForSObject(records, '  Account  ')).toHaveLength(1);
    });
});

describe('fieldSetCountBySObject', () => {
    it('counts only active records, grouped by SObject', () => {
        const records = [
            inclusion({ developerName: 'A', sobject: 'Account', isActive: true }),
            inclusion({ developerName: 'B', sobject: 'Account', isActive: true }),
            inclusion({ developerName: 'C', sobject: 'Account', isActive: false }),
            inclusion({ developerName: 'D', sobject: 'Contact', isActive: true }),
        ];

        const counts = fieldSetCountBySObject(records);
        expect(counts.get('Account')).toBe(2);
        expect(counts.get('Contact')).toBe(1);
        expect(counts.has('Fish__c')).toBe(false);
    });
});

describe('fieldSetCountLabel', () => {
    it('renders the canvas\'s exact wording for zero, one, and many', () => {
        expect(fieldSetCountLabel(0)).toBe('no field sets');
        expect(fieldSetCountLabel(1)).toBe('1 field set');
        expect(fieldSetCountLabel(3)).toBe('3 field sets');
    });
});

describe('suggestFieldSetInclusionDeveloperName', () => {
    it('builds a valid, letter-starting DeveloperName from the SObject and field set name', () => {
        const name = suggestFieldSetInclusionDeveloperName('Account', 'AccountTierFields', new Set());
        expect(name).toBe('Account_AccountTierFields_Inclusion');
    });

    it('sanitizes a custom-object SObject name into valid characters', () => {
        const name = suggestFieldSetInclusionDeveloperName('Fish__c', 'SloganFields', new Set());
        expect(/^[A-Za-z][A-Za-z0-9_]*$/.test(name)).toBe(true);
        expect(name.endsWith('_')).toBe(false);
        expect(name.length).toBeLessThanOrEqual(40);
    });

    it('appends a numeric suffix on a collision, keeping the result within 40 characters', () => {
        const base = suggestFieldSetInclusionDeveloperName('Account', 'AccountTierFields', new Set());
        const suggestion = suggestFieldSetInclusionDeveloperName('Account', 'AccountTierFields', new Set([base]));

        expect(suggestion).not.toBe(base);
        expect(suggestion.endsWith('_2')).toBe(true);
        expect(suggestion.length).toBeLessThanOrEqual(40);
    });
});
