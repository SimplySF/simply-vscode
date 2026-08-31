import { describe, expect, it } from 'vitest';
import { buildSObjectBindingCards } from '../../src/webview/lib/sobjectBindingsView';
import type { At4dxBindingRow } from '../../src/webview/types';

function row(overrides: Partial<At4dxBindingRow> = {}): At4dxBindingRow {
    return {
        bindingType: 'Selector',
        developerName: 'AccountsSelectorBinding',
        label: 'Accounts Selector',
        key: 'Account',
        to: 'AccountsSelector',
        source: 'local',
        effective: true,
        ...overrides,
    } as At4dxBindingRow;
}

describe('buildSObjectBindingCards', () => {
    it('groups Selector/Domain/UnitOfWork rows by SObject, and excludes Service (which has no SObject)', () => {
        const rows = [
            row({ bindingType: 'Service', developerName: 'S', key: 'IPricingService', to: 'PricingServiceImpl' }),
            row({ bindingType: 'Domain', developerName: 'D', key: 'Account', to: 'Accounts' }),
        ];

        const cards = buildSObjectBindingCards(rows);

        expect(cards.map((c) => c.sobject)).toEqual(['Account']);
    });

    it('renders a gap for a missing Domain or Unit of Work binding, but never for a missing Selector', () => {
        const cards = buildSObjectBindingCards([row({ key: 'Account' })]);

        expect(cards[0].gapCount).toBe(2);
        expect(cards[0].rows.map((r) => r.kind)).toEqual(['selector', 'domain-gap', 'unit-of-work-gap']);
    });

    it('reports zero gaps once every type is present, one gap when only one type is missing', () => {
        const full = buildSObjectBindingCards([
            row({ bindingType: 'Selector', key: 'Account' }),
            row({ bindingType: 'Domain', developerName: 'D', key: 'Account', to: 'Accounts' }),
            row({ bindingType: 'UnitOfWork', developerName: 'U', key: 'Account', to: undefined, sequence: 10 }),
        ]);
        expect(full[0].gapCount).toBe(0);
        expect(full[0].bindingCount).toBe(3);

        const missingOne = buildSObjectBindingCards([
            row({ bindingType: 'Selector', key: 'Account' }),
            row({ bindingType: 'UnitOfWork', developerName: 'U', key: 'Account', to: undefined, sequence: 10 }),
        ]);
        expect(missingOne[0].gapCount).toBe(1);
        expect(missingOne[0].rows.map((r) => r.kind)).toEqual(['selector', 'domain-gap', 'unit-of-work']);
    });

    it('orders cards by ascending Unit of Work sequence, then alphabetically for SObjects with no Unit of Work binding at all', () => {
        const rows = [
            row({ bindingType: 'UnitOfWork', developerName: 'U1', key: 'Widget__c', to: undefined, sequence: 30 }),
            row({ bindingType: 'UnitOfWork', developerName: 'U2', key: 'Account', to: undefined, sequence: 10 }),
            row({ bindingType: 'Selector', developerName: 'S3', key: 'Zebra__c' }),
            row({ bindingType: 'Selector', developerName: 'S4', key: 'Aardvark__c' }),
        ];

        const cards = buildSObjectBindingCards(rows);

        expect(cards.map((c) => c.sobject)).toEqual(['Account', 'Widget__c', 'Aardvark__c', 'Zebra__c']);
    });

    it('keeps two SObjects sharing a Unit of Work sequence adjacent, in scan order between them', () => {
        const rows = [
            row({ bindingType: 'UnitOfWork', developerName: 'U1', key: 'Fish__c', to: undefined, sequence: 20 }),
            row({ bindingType: 'UnitOfWork', developerName: 'U2', key: 'Widget__c', to: undefined, sequence: 20 }),
        ];

        const cards = buildSObjectBindingCards(rows);

        expect(cards.map((c) => c.sobject)).toEqual(['Fish__c', 'Widget__c']);
    });

    it('carries the Unit of Work row\'s commit-position label through onto the card', () => {
        const rows = [row({ bindingType: 'UnitOfWork', developerName: 'U', key: 'Account', to: undefined, sequence: 10 })];

        const cards = buildSObjectBindingCards(rows);
        const uowRow = cards[0].rows.find((r) => r.kind === 'unit-of-work');

        expect(uowRow?.kind).toBe('unit-of-work');
        expect(uowRow && 'row' in uowRow ? uowRow.row.commitPosition : undefined).toBe('1st');
    });
});
