import { describe, expect, it } from 'vitest';
import { applicationFactoryDrawerCopy, domainProcessDrawerCopy, priorityCompetition, type CopySegment } from '../../src/webview/lib/bindingDrawerCopy';
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

/** Flattens a segment array's plain text, ignoring emphasis — the quickest way to assert overall wording. */
function text(segments: CopySegment[]): string {
    return segments.map((s) => s.text).join('');
}

describe('priorityCompetition', () => {
    it('is undefined when nothing else shares the key', () => {
        expect(priorityCompetition([], 'Account', undefined, 10)).toBeUndefined();
    });

    it('names a win over a lower/blank sibling', () => {
        const siblings = [row({ developerName: 'Other', to: 'PremiumAccountsSelector', priority: undefined })];
        expect(priorityCompetition(siblings, 'Account', undefined, 20)).toEqual({ kind: 'wins', otherLabel: 'PremiumAccountsSelector', otherPriorityLabel: 'blank' });
    });

    it('names a tie, never as a win or a loss', () => {
        const siblings = [row({ developerName: 'Other', to: 'PremiumAccountsSelector', priority: 10 })];
        expect(priorityCompetition(siblings, 'Account', undefined, 10)).toEqual({ kind: 'ties', otherLabel: 'PremiumAccountsSelector', otherPriorityLabel: 'priority 10' });
    });

    it('names being shadowed by a higher sibling', () => {
        const siblings = [row({ developerName: 'Other', to: 'PremiumAccountsSelector', priority: 30 })];
        expect(priorityCompetition(siblings, 'Account', undefined, 10)).toEqual({ kind: 'shadowed', otherLabel: 'PremiumAccountsSelector', otherPriorityLabel: 'priority 30' });
    });

    it('excludes the record being edited from its own sibling comparison', () => {
        const siblings = [row({ developerName: 'Self', to: 'AccountsSelector', priority: 10 })];
        expect(priorityCompetition(siblings, 'Account', 'Self', 10)).toBeUndefined();
    });
});

describe('applicationFactoryDrawerCopy — Selector', () => {
    it('create, opened with an empty SObject (sheet-level + New Binding — 2a)', () => {
        const copy = applicationFactoryDrawerCopy({
            mode: 'create',
            bindingType: 'Selector',
            developerName: 'Shipment_Selector_Binding',
            key: '',
            to: '',
            priority: undefined,
            sequence: undefined,
            allRows: [],
            domainProcessBindingCount: undefined,
            prefilledFromGap: false,
        });

        expect(copy.title).toBe('New selector binding');
        expect(copy.breadcrumbLead).toBe('+ New Binding');
        expect(copy.breadcrumbSuffix).toBe('no SObject pre-answered');
        expect(copy.typePillLabel).toBe('SELECTOR');
        expect(copy.typePillClass).toBe('af-type-selector');
        expect(text(copy.resultingBinding)).toBe('Selector.newInstance(SObject) resolves to …, with no field sets queried yet.');
        expect(copy.cliPreview).toBe('binding create --type selector --developer-name Shipment_Selector_Binding');
    });

    it('edit, wins its priority tie — competitor segment is mono, everything else plain', () => {
        const allRows = [
            row({ developerName: 'Winner', to: 'AccountsSelector', priority: 20, key: 'Account' }),
            row({ developerName: 'Loser', to: 'PremiumAccountsSelector', priority: undefined, key: 'Account' }),
        ];

        const copy = applicationFactoryDrawerCopy({
            mode: 'edit',
            bindingType: 'Selector',
            developerName: 'Winner',
            key: 'Account',
            to: 'AccountsSelector',
            priority: 20,
            sequence: undefined,
            allRows,
            domainProcessBindingCount: undefined,
            prefilledFromGap: false,
        });

        expect(copy.breadcrumbLead).toBe('Account');
        expect(copy.breadcrumbSuffix).toBe('AccountsSelector');
        expect(text(copy.resultingBinding)).toBe(
            'Selector.newInstance(Account) resolves to AccountsSelector, with no field sets queried yet — wins at priority 20 over PremiumAccountsSelector, which sits shadowed at blank.',
        );
        expect(copy.resultingBinding.find((s) => s.text === 'PremiumAccountsSelector')?.emphasis).toBe('mono');
        expect(copy.cliPreview).toBeUndefined();
    });
});

describe('applicationFactoryDrawerCopy — Domain', () => {
    it('create, entered from a card\'s own "Add" link on an unbound row (2b) — CLOSES A GAP framing', () => {
        const copy = applicationFactoryDrawerCopy({
            mode: 'create',
            bindingType: 'Domain',
            developerName: 'Fish_Domain_Binding',
            key: 'Fish__c',
            to: 'Fishes',
            priority: undefined,
            sequence: undefined,
            allRows: [],
            domainProcessBindingCount: undefined,
            prefilledFromGap: true,
        });

        expect(copy.breadcrumbLead).toBe('Fish__c');
        expect(copy.breadcrumbSuffix).toBe('was Not bound');
        expect(text(copy.resultingBinding)).toBe(
            "Fish__c's domain process bindings don't resolve today, because nothing provides its domain. Saving this makes them resolve — no change to their own records.",
        );
    });

    it('edit, surfaces how many Domain Process bindings resolve through it', () => {
        const copy = applicationFactoryDrawerCopy({
            mode: 'edit',
            bindingType: 'Domain',
            developerName: 'Account_Domain_Binding',
            key: 'Account',
            to: 'Accounts',
            priority: undefined,
            sequence: undefined,
            allRows: [],
            domainProcessBindingCount: 5,
            prefilledFromGap: false,
        });

        expect(text(copy.resultingBinding)).toBe('Domain.newInstance(records) on Account resolves to Accounts, and 5 domain process bindings resolve through it.');
    });
});

describe('applicationFactoryDrawerCopy — UnitOfWork', () => {
    it('create joins the shared Unit of Work; edit already has', () => {
        const allRows = [row({ bindingType: 'UnitOfWork', developerName: 'Existing', key: 'Account', to: undefined, sequence: 10 })];

        const create = applicationFactoryDrawerCopy({
            mode: 'create',
            bindingType: 'UnitOfWork',
            developerName: 'Shipment_UOW',
            key: 'Shipment__c',
            to: '',
            priority: undefined,
            sequence: 50,
            allRows,
            domainProcessBindingCount: undefined,
            prefilledFromGap: true,
        });
        expect(text(create.resultingBinding)).toBe('Shipment__c joins the shared Unit of Work and commits 2nd of 2.');

        const edit = applicationFactoryDrawerCopy({
            mode: 'edit',
            bindingType: 'UnitOfWork',
            developerName: 'Existing',
            key: 'Account',
            to: '',
            priority: undefined,
            sequence: 10,
            allRows,
            domainProcessBindingCount: undefined,
            prefilledFromGap: false,
        });
        expect(text(edit.resultingBinding)).toBe('Account commits 1st of 1 in the shared Unit of Work.');
        expect(edit.breadcrumbSuffix).toBe('sequence 10');
    });
});

describe('applicationFactoryDrawerCopy — Service', () => {
    it('create on an unbound interface (5b)', () => {
        const copy = applicationFactoryDrawerCopy({
            mode: 'create',
            bindingType: 'Service',
            developerName: 'Shipping_Service_Binding',
            key: 'IShippingService',
            to: 'ShippingServiceImpl',
            priority: undefined,
            sequence: undefined,
            allRows: [],
            domainProcessBindingCount: undefined,
            prefilledFromGap: false,
        });

        expect(copy.typePillClass).toBe('af-type-service');
        expect(copy.breadcrumbLead).toBe('+ New Binding');
        expect(copy.breadcrumbSuffix).toBe('not bound yet');
        expect(text(copy.resultingBinding)).toBe('Application.Service.newInstance(IShippingService.class) returns a new ShippingServiceImpl — this interface has no binding yet.');
        expect(copy.cliPreview).toBe('binding create --type service --developer-name Shipping_Service_Binding --binding-interface IShippingService --to ShippingServiceImpl');
    });

    it('create on an already-tied interface names the tie', () => {
        const allRows = [row({ bindingType: 'Service', developerName: 'Existing', key: 'IPricingService', to: 'PricingServiceImpl', priority: 10 })];

        const copy = applicationFactoryDrawerCopy({
            mode: 'create',
            bindingType: 'Service',
            developerName: 'New',
            key: 'IPricingService',
            to: 'NewPricingServiceImpl',
            priority: 10,
            sequence: undefined,
            allRows,
            domainProcessBindingCount: undefined,
            prefilledFromGap: false,
        });

        expect(text(copy.resultingBinding)).toBe(
            'Application.Service.newInstance(IPricingService.class) resolves to NewPricingServiceImpl — ties PricingServiceImpl at priority 10 — the last one loaded wins.',
        );
    });
});

describe('domainProcessDrawerCopy', () => {
    it('create — scope locked, dashed Action pill', () => {
        const copy = domainProcessDrawerCopy({
            mode: 'create',
            sobject: 'Account',
            processContext: 'TriggerExecution',
            triggerOperation: 'Before_Insert',
            domainMethodToken: '',
            familyLabel: 'Created',
            type: 'Action',
            classToInject: 'AssignOwner',
            order: '10.4',
            developerName: 'Account_Before_Insert_Assign_Owner',
        });

        expect(copy.title).toBe('New domain process binding');
        expect(copy.breadcrumbLead).toBe('Account / Created');
        expect(copy.breadcrumbSuffix).toBe('scope locked');
        expect(copy.typePillLabel).toBe('ACTION');
        expect(copy.cliPreview).toBe(
            'domain-process-binding create --developer-name Account_Before_Insert_Assign_Owner --sobject Account --type action --class-to-inject AssignOwner --order 10.4 --trigger-operation Before_Insert',
        );
    });

    it('edit — Criteria pill, no CLI preview', () => {
        const copy = domainProcessDrawerCopy({
            mode: 'edit',
            sobject: 'Account',
            processContext: 'TriggerExecution',
            triggerOperation: 'Before_Insert',
            domainMethodToken: '',
            familyLabel: 'Created',
            type: 'Criteria',
            classToInject: 'FishSlogansCriteria',
            order: '10.1',
            developerName: 'FishCompanySlogans10_10Criteria',
        });

        expect(copy.title).toBe('Edit domain process binding');
        expect(copy.typePillLabel).toBe('CRITERIA');
        expect(copy.typePillClass).toBe('type-pill type-criteria');
        expect(copy.breadcrumbSuffix).toBe('');
        expect(copy.cliPreview).toBeUndefined();
    });

    it('uses the Domain Method Token flag instead of Trigger Operation outside Trigger Execution', () => {
        const copy = domainProcessDrawerCopy({
            mode: 'create',
            sobject: 'Account',
            processContext: 'DomainMethodExecution',
            triggerOperation: '',
            domainMethodToken: 'calculateTotals',
            familyLabel: 'Domain Method Execution',
            type: 'Action',
            classToInject: 'CalcTotals',
            order: '10',
            developerName: 'Account_CalcTotals',
        });

        expect(copy.cliPreview).toContain('--domain-method-token calculateTotals');
        expect(copy.cliPreview).not.toContain('--trigger-operation');
    });
});
