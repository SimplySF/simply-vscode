import { describe, expect, it } from 'vitest';
import {
    eventColumnState,
    groupPlatformEventSubscriptions,
    issuesByRecordKey,
    MATCHER_RULE_REQUIRED_FIELDS,
    missingMatchField,
    missReasonClause,
    NEVER_FIRES_NOTE,
    partitionPlatformEventIssuesBySeverity,
    problemCount,
    recordKey,
    rowStatus,
    throwsHazardNote,
} from '../../src/webview/lib/platformEventView';
import type { PlatformEventDistributionMiss, PlatformEventSubscriptionIssue, RawPlatformEventSubscriptionRecord } from '../../src/webview/types';

function record(overrides: Partial<RawPlatformEventSubscriptionRecord> = {}): RawPlatformEventSubscriptionRecord {
    return {
        developerName: 'AccountTierRecalc',
        label: 'Account Tier Recalc',
        eventBus: 'Sales_Event__e',
        consumer: 'AccountTierRecalcConsumer',
        matcherRule: 'MatchCategoryAndEvent',
        eventCategory: 'Account',
        event: 'TierChanged',
        isActive: true,
        executeSynchronous: true,
        source: 'force-app',
        ...overrides,
    };
}

describe('MATCHER_RULE_REQUIRED_FIELDS / missingMatchField', () => {
    it('MatchEventBus needs nothing', () => {
        expect(MATCHER_RULE_REQUIRED_FIELDS.MatchEventBus).toEqual([]);
        expect(missingMatchField(record({ matcherRule: 'MatchEventBus', eventCategory: undefined, event: undefined }))).toBeUndefined();
    });

    it('MatchCategory needs only eventCategory', () => {
        expect(missingMatchField(record({ matcherRule: 'MatchCategory', eventCategory: undefined }))).toBe('eventCategory');
        expect(missingMatchField(record({ matcherRule: 'MatchCategory', eventCategory: 'Account', event: undefined }))).toBeUndefined();
    });

    it('MatchEvent needs only event', () => {
        expect(missingMatchField(record({ matcherRule: 'MatchEvent', event: undefined }))).toBe('event');
        expect(missingMatchField(record({ matcherRule: 'MatchEvent', event: 'TierChanged', eventCategory: undefined }))).toBeUndefined();
    });

    it('MatchCategoryAndEvent needs both — reports the first missing one', () => {
        expect(missingMatchField(record({ matcherRule: 'MatchCategoryAndEvent', eventCategory: undefined, event: 'TierChanged' }))).toBe('eventCategory');
        expect(missingMatchField(record({ matcherRule: 'MatchCategoryAndEvent', eventCategory: 'Account', event: undefined }))).toBe('event');
        expect(missingMatchField(record({ matcherRule: 'MatchCategoryAndEvent', eventCategory: 'Account', event: 'TierChanged' }))).toBeUndefined();
    });
});

describe('eventColumnState', () => {
    it('shows the real value when the rule dereferences event and it is present', () => {
        expect(eventColumnState(record({ matcherRule: 'MatchEvent', event: 'TierChanged' }))).toEqual({ kind: 'value', text: 'TierChanged' });
    });

    it('shows "any" when the rule does not dereference event', () => {
        expect(eventColumnState(record({ matcherRule: 'MatchCategory', event: undefined }))).toEqual({ kind: 'any' });
        expect(eventColumnState(record({ matcherRule: 'MatchEventBus', event: undefined }))).toEqual({ kind: 'any' });
    });

    it('shows the blank hazard when the rule dereferences event and it is empty', () => {
        expect(eventColumnState(record({ matcherRule: 'MatchCategoryAndEvent', event: undefined }))).toEqual({ kind: 'blank' });
    });
});

describe('rowStatus', () => {
    it('inactive wins over every other state', () => {
        expect(rowStatus({ isActive: false }, [{ rule: 'matcher-rule-missing-field' } as PlatformEventSubscriptionIssue])).toBe('inactive');
    });

    it('throws when a matcher-rule-missing-field issue applies', () => {
        expect(rowStatus({ isActive: true }, [{ rule: 'matcher-rule-missing-field' } as PlatformEventSubscriptionIssue])).toBe('throws');
    });

    it('never-fires when an unreachable-subscription issue applies', () => {
        expect(rowStatus({ isActive: true }, [{ rule: 'unreachable-subscription' } as PlatformEventSubscriptionIssue])).toBe('never-fires');
    });

    it('active when none of the above apply', () => {
        expect(rowStatus({ isActive: true }, [])).toBe('active');
        expect(rowStatus({ isActive: true }, [{ rule: 'duplicate-consumer' } as PlatformEventSubscriptionIssue])).toBe('active');
    });
});

describe('throwsHazardNote', () => {
    it('names the blank field and suggests dropping it from the rule', () => {
        const note = throwsHazardNote(record({ matcherRule: 'MatchCategoryAndEvent', eventCategory: 'Opportunity', event: undefined }));
        expect(note?.body).toContain('Event__c');
        expect(note?.body).toContain('Set an event name');
        expect(note?.body).toContain('Bus + Category');
    });

    it('suggests MatchEventBus when the only required field is the one that is blank', () => {
        const note = throwsHazardNote(record({ matcherRule: 'MatchCategory', eventCategory: undefined }));
        expect(note?.body).toContain('EventCategory__c');
        expect(note?.body).toContain('Bus only');
    });

    it('returns undefined when nothing required is actually blank', () => {
        expect(throwsHazardNote(record({ matcherRule: 'MatchEventBus', eventCategory: undefined, event: undefined }))).toBeUndefined();
    });
});

describe('NEVER_FIRES_NOTE', () => {
    it('is the canvas copy verbatim', () => {
        expect(NEVER_FIRES_NOTE.lead).toBe('Registered but unreachable.');
        expect(NEVER_FIRES_NOTE.body).toContain("distributor's pre-filter");
    });
});

describe('groupPlatformEventSubscriptions', () => {
    it('groups Event Bus → Category, alphabetically, with a trailing No category band', () => {
        const records = [
            record({ developerName: 'A', eventBus: 'Sales_Event__e', eventCategory: 'Opportunity' }),
            record({ developerName: 'B', eventBus: 'Sales_Event__e', eventCategory: 'Account' }),
            record({ developerName: 'C', eventBus: 'Sales_Event__e', eventCategory: undefined }),
            record({ developerName: 'D', eventBus: 'Ops_Event__e', eventCategory: 'Intake__c' }),
        ];

        const groups = groupPlatformEventSubscriptions(records);

        expect(groups.map((g) => g.eventBus)).toEqual(['Ops_Event__e', 'Sales_Event__e']);
        const sales = groups.find((g) => g.eventBus === 'Sales_Event__e')!;
        expect(sales.categories.map((c) => c.label)).toEqual(['Account', 'Opportunity', 'No category']);
        expect(sales.categoryCount).toBe(2);
        expect(sales.recordCount).toBe(3);
    });

    it('omits the No category band entirely when every record has a category', () => {
        const groups = groupPlatformEventSubscriptions([record({ eventCategory: 'Account' })]);
        expect(groups[0].categories.map((c) => c.label)).toEqual(['Account']);
    });
});

describe('issuesByRecordKey / problemCount', () => {
    it('groups issues by developerName + source, and problemCount counts throws/never-fires rows only', () => {
        const records = [
            record({ developerName: 'Throws', source: 's1', matcherRule: 'MatchEvent', event: undefined }),
            record({ developerName: 'NeverFires', source: 's1', matcherRule: 'MatchEventBus', eventCategory: undefined, event: undefined }),
            record({ developerName: 'Fine', source: 's1' }),
        ];
        const issues: PlatformEventSubscriptionIssue[] = [
            { severity: 'error', rule: 'matcher-rule-missing-field', scope: 'record', message: 'x', developerName: 'Throws', source: 's1' },
            { severity: 'warning', rule: 'unreachable-subscription', scope: 'record', message: 'x', developerName: 'NeverFires', source: 's1' },
        ];

        const byKey = issuesByRecordKey(issues);
        expect(byKey.get(recordKey(records[0]))).toHaveLength(1);
        expect(problemCount(records, byKey)).toBe(2);
    });
});

describe('partitionPlatformEventIssuesBySeverity', () => {
    it('splits errors and warnings, index-tagged against the full array', () => {
        const issues: PlatformEventSubscriptionIssue[] = [
            { severity: 'error', rule: 'duplicate-consumer', scope: 'scan', message: 'a', source: 's' },
            { severity: 'warning', rule: 'unreachable-subscription', scope: 'record', message: 'b', source: 's' },
        ];
        const { errors, warnings } = partitionPlatformEventIssuesBySeverity(issues);
        expect(errors).toEqual([{ issue: issues[0], index: 0 }]);
        expect(warnings).toEqual([{ issue: issues[1], index: 1 }]);
    });
});

describe('missReasonClause', () => {
    const records = [record({ developerName: 'X', source: 's1', matcherRule: 'MatchCategoryAndEvent', eventCategory: 'Opportunity', event: undefined })];

    function miss(overrides: Partial<PlatformEventDistributionMiss> = {}): PlatformEventDistributionMiss {
        return { developerName: 'X', consumer: 'XConsumer', eventBus: 'Sales_Event__e', reason: 'inactive', source: 's1', ...overrides };
    }

    it('inactive — canvas copy verbatim', () => {
        expect(missReasonClause(miss({ reason: 'inactive' }), records)).toBe('Inactive — never loaded into the DI module');
    });

    it('prefiltered — canvas copy verbatim', () => {
        expect(missReasonClause(miss({ reason: 'prefiltered' }), records)).toBe('Dropped by the pre-filter — no category or event name to match on');
    });

    it('matcher-rule-missing-field — names the blank field', () => {
        expect(missReasonClause(miss({ reason: 'matcher-rule-missing-field' }), records)).toContain('Event is blank');
    });

    it('no-match — states the record’s own configured match field(s)', () => {
        const noMatchRecords = [record({ developerName: 'Y', source: 's1', matcherRule: 'MatchCategory', eventCategory: 'Opportunity' })];
        expect(missReasonClause(miss({ developerName: 'Y', reason: 'no-match' }), noMatchRecords)).toBe('Category is Opportunity');
    });

    it('no-match — both fields when the rule requires both', () => {
        const both = [record({ developerName: 'Z', source: 's1', matcherRule: 'MatchCategoryAndEvent', eventCategory: 'Opportunity', event: 'Whatever' })];
        expect(missReasonClause(miss({ developerName: 'Z', reason: 'no-match' }), both)).toBe('Category is Opportunity, event is Whatever');
    });
});
