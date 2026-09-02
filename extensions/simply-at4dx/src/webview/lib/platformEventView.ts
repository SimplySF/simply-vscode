/**
 * Pure, DOM-free logic for the Platform Events explorer (docs/design/0018) — bus/category grouping,
 * per-row status derivation, the matcher-rule display/required-field table, and the match simulator's
 * miss-reason clauses. Mirrors `applicationFactoryView.ts`'s role for the Application Factory explorer.
 */
import type { IndexedIssue, MatcherRule, PlatformEventDistributionMiss, PlatformEventSubscriptionIssue, RawPlatformEventSubscriptionRecord } from '../types';

export const ALL_MATCHER_RULES: MatcherRule[] = ['MatchEventBus', 'MatchCategory', 'MatchEvent', 'MatchCategoryAndEvent'];

/** The create/edit drawer's dropdown copy — canvas 7c's exact wording, mapped onto the library's real enum values. See docs/design/0018's deviation 1. */
export const MATCHER_RULE_LABEL: Record<MatcherRule, string> = {
    MatchEventBus: 'Match Event Bus',
    MatchCategory: 'Match Event Bus and Category',
    MatchEvent: 'Match Event Bus and Event Name',
    MatchCategoryAndEvent: 'Match Event Bus and Category and Event Name',
};

/** The explorer row's rule-label column — canvas 7a's exact wording ("Bus + Category + Event", etc.). */
export const MATCHER_RULE_SHORT_LABEL: Record<MatcherRule, string> = {
    MatchEventBus: 'Bus only',
    MatchCategory: 'Bus + Category',
    MatchEvent: 'Bus + Event',
    MatchCategoryAndEvent: 'Bus + Category + Event',
};

export type MatchField = 'eventCategory' | 'event';

/** Which of `eventCategory`/`event` each matcher rule dereferences without a null guard — mirrors `simply-aep-core`'s own `MATCHER_RULE_REQUIRED_FIELDS`-shaped table (not exported by the library, so duplicated here the same way `applicationFactoryView.ts` duplicates `isCustomObjectApiName`). The single source of truth for which drawer fields are required and for the row/miss hazard copy below. */
export const MATCHER_RULE_REQUIRED_FIELDS: Record<MatcherRule, MatchField[]> = {
    MatchEventBus: [],
    MatchCategory: ['eventCategory'],
    MatchEvent: ['event'],
    MatchCategoryAndEvent: ['eventCategory', 'event'],
};

const MATCH_FIELD_API_NAME: Record<MatchField, string> = { eventCategory: 'EventCategory__c', event: 'Event__c' };
const MATCH_FIELD_FORM_LABEL: Record<MatchField, string> = { eventCategory: 'Event Category', event: 'Event' };

/** @returns Whichever of `record`'s required match fields is blank, or `undefined` if none is (either the rule needs nothing, or every required field is populated). */
export function missingMatchField(record: Pick<RawPlatformEventSubscriptionRecord, 'matcherRule' | 'eventCategory' | 'event'>): MatchField | undefined {
    return MATCHER_RULE_REQUIRED_FIELDS[record.matcherRule].find((field) => !record[field]);
}

/** The matcher rule left over once `field` is dropped from `rule`'s requirements — `MATCHER_RULE_REQUIRED_FIELDS`'s inverse lookup, used to suggest a fix for a blank required field. */
function ruleWithoutField(rule: MatcherRule, field: MatchField): MatcherRule {
    const remaining = MATCHER_RULE_REQUIRED_FIELDS[rule].filter((f) => f !== field);
    return ALL_MATCHER_RULES.find((candidate) => {
        const req = MATCHER_RULE_REQUIRED_FIELDS[candidate];
        return req.length === remaining.length && req.every((f) => remaining.includes(f));
    })!;
}

export type EventColumnState = { kind: 'value'; text: string } | { kind: 'any' } | { kind: 'blank' };

/** The explorer row's event-value column (7a) — the real `event` value when the rule dereferences it, `any` when it doesn't, or the red "blank" hazard glyph when the rule needs it and it's empty. */
export function eventColumnState(record: Pick<RawPlatformEventSubscriptionRecord, 'matcherRule' | 'event'>): EventColumnState {
    if (!MATCHER_RULE_REQUIRED_FIELDS[record.matcherRule].includes('event')) {
        return { kind: 'any' };
    }
    return record.event ? { kind: 'value', text: record.event } : { kind: 'blank' };
}

export type RowStatus = 'active' | 'inactive' | 'throws' | 'never-fires';

/** @returns Which of `docs/design/0018`'s four row states `record` is in, given the issues `validatePlatformEventSubscriptions` found for it. Checked in this order — a record can only be in one state. */
export function rowStatus(record: Pick<RawPlatformEventSubscriptionRecord, 'isActive'>, recordIssues: PlatformEventSubscriptionIssue[]): RowStatus {
    if (!record.isActive) {
        return 'inactive';
    }
    if (recordIssues.some((issue) => issue.rule === 'matcher-rule-missing-field')) {
        return 'throws';
    }
    if (recordIssues.some((issue) => issue.rule === 'unreachable-subscription')) {
        return 'never-fires';
    }
    return 'active';
}

/** @returns The composite key `RawPlatformEventSubscriptionRecord`s and their issues are matched by — a bare `developerName` isn't unique across sources, same reasoning `applicationFactoryView.ts`'s `recordKey` gives. */
export function recordKey(record: { developerName: string; source: string }): string {
    return `${record.developerName} ${record.source}`;
}

/** Groups `issues` by the record they belong to (`developerName` + `source`), so a row can look up its own issues in O(1) without re-scanning the whole issue list per row. */
export function issuesByRecordKey(issues: PlatformEventSubscriptionIssue[]): Map<string, PlatformEventSubscriptionIssue[]> {
    const map = new Map<string, PlatformEventSubscriptionIssue[]>();
    for (const issue of issues) {
        if (!issue.developerName) {
            continue;
        }
        const key = `${issue.developerName} ${issue.source}`;
        const group = map.get(key) ?? [];
        group.push(issue);
        map.set(key, group);
    }
    return map;
}

/** The row-level hazard note under a `throws` row (7a's `matcher-rule-missing-field` inline note) — `undefined` if `record` isn't actually missing a required match field (shouldn't happen for a row whose status is `throws`, but keeps this a total function). */
export function throwsHazardNote(record: RawPlatformEventSubscriptionRecord): { lead: string; body: string } | undefined {
    const missingField = missingMatchField(record);
    if (!missingField) {
        return undefined;
    }
    const suggestedRule = ruleWithoutField(record.matcherRule, missingField);
    const setClause = missingField === 'event' ? 'Set an event name' : 'Set an event category';
    return {
        lead: 'NullPointerException at distribution.',
        body: `The rule matches on ${MATCH_FIELD_API_NAME[missingField]}, but the field is blank — PlatformEventDistributor calls .equalsIgnoreCase() on it for every event on this bus. ${setClause}, or change the rule to ${MATCHER_RULE_SHORT_LABEL[suggestedRule]}.`,
    };
}

/** The row-level hazard note under a `never-fires` row (7a's `unreachable-subscription` inline note) — canvas copy verbatim; only ever applies to `MatchEventBus` records (see `simply-aep-core`'s own `unreachableSubscriptionIssues`), so unlike {@link throwsHazardNote} this is a fixed string, not templated. */
export const NEVER_FIRES_NOTE = {
    lead: 'Registered but unreachable.',
    body: "Bus only matches anything, but the distributor's pre-filter keeps a subscription only if its EventCategory__c or Event__c appears in the incoming batch — and both are blank here, so nothing ever reaches the matcher. Populate either field to make the rule live.",
};

export type CategoryGroup = {
    /** `undefined` for the trailing "No category" band. */
    category: string | undefined;
    label: string;
    records: RawPlatformEventSubscriptionRecord[];
};

export type BusGroup = {
    eventBus: string;
    categories: CategoryGroup[];
    recordCount: number;
    /** Distinct real categories only — the "No category" band doesn't count toward this, matching canvas 7a's own `Sales_Event__e` example (2 categories, 5 subscriptions, one of which is in "No category"). */
    categoryCount: number;
};

/**
 * Groups `records` Event Bus → Category → subscriptions (7a) — bus names and category names both sorted
 * alphabetically (the canvas doesn't specify an order and scan order isn't meaningful here), with a
 * trailing "No category" band for a bus's records with a blank `eventCategory`, present only when at
 * least one such record exists.
 */
export function groupPlatformEventSubscriptions(records: RawPlatformEventSubscriptionRecord[]): BusGroup[] {
    const byBus = new Map<string, RawPlatformEventSubscriptionRecord[]>();
    for (const record of records) {
        const group = byBus.get(record.eventBus) ?? [];
        group.push(record);
        byBus.set(record.eventBus, group);
    }

    const busNames = [...byBus.keys()].sort((a, b) => a.localeCompare(b));
    return busNames.map((eventBus) => {
        const busRecords = byBus.get(eventBus)!;

        const byCategory = new Map<string, RawPlatformEventSubscriptionRecord[]>();
        for (const record of busRecords) {
            const key = record.eventCategory ?? '';
            const group = byCategory.get(key) ?? [];
            group.push(record);
            byCategory.set(key, group);
        }

        const categoryNames = [...byCategory.keys()].filter((key) => key !== '').sort((a, b) => a.localeCompare(b));
        const categories: CategoryGroup[] = categoryNames.map((name) => ({ category: name, label: name, records: byCategory.get(name)! }));
        const noCategory = byCategory.get('');
        if (noCategory) {
            categories.push({ category: undefined, label: 'No category', records: noCategory });
        }

        return { eventBus, categories, recordCount: busRecords.length, categoryCount: categoryNames.length };
    });
}

/** How many of `records` are in the `throws`/`never-fires` states — the "· N problem(s)" suffix on a bus/category header. */
export function problemCount(records: RawPlatformEventSubscriptionRecord[], issuesByKey: Map<string, PlatformEventSubscriptionIssue[]>): number {
    return records.filter((record) => {
        const status = rowStatus(record, issuesByKey.get(recordKey(record)) ?? []);
        return status === 'throws' || status === 'never-fires';
    }).length;
}

/** Splits `issues` into `errors`/`warnings`, index-tagged against the full array — same shape `applicationFactoryView.ts`'s `partitionBySeverity` already provides for `BindingIssue`, duplicated here over `PlatformEventSubscriptionIssue` since the two issue types aren't structurally interchangeable at the type level even though the logic is identical. */
export function partitionPlatformEventIssuesBySeverity(issues: PlatformEventSubscriptionIssue[]): {
    errors: IndexedIssue<PlatformEventSubscriptionIssue>[];
    warnings: IndexedIssue<PlatformEventSubscriptionIssue>[];
} {
    const indexed = issues.map((issue, index) => ({ issue, index }));
    return {
        errors: indexed.filter((entry) => entry.issue.severity === 'error'),
        warnings: indexed.filter((entry) => entry.issue.severity === 'warning'),
    };
}

/** The match simulator's `Did not match` list, one clause per {@link PlatformEventDistributionMiss}. See docs/design/0018's "Match simulator" section for the source of each template. */
export function missReasonClause(miss: PlatformEventDistributionMiss, records: RawPlatformEventSubscriptionRecord[]): string {
    if (miss.reason === 'inactive') {
        return 'Inactive — never loaded into the DI module';
    }
    if (miss.reason === 'prefiltered') {
        return 'Dropped by the pre-filter — no category or event name to match on';
    }

    const record = records.find((r) => r.developerName === miss.developerName && r.source === miss.source);

    if (miss.reason === 'matcher-rule-missing-field') {
        const missingField = record ? missingMatchField(record) : undefined;
        const fieldLabel = missingField ? MATCH_FIELD_FORM_LABEL[missingField] : 'A required field';
        return `${fieldLabel} is blank — this record would throw before reaching the comparison`;
    }

    // 'no-match': state whichever of the record's own configured match field(s) differ from the
    // simulated event, per its matcherRule — not drawn in the canvas (7b's own example has no plain
    // non-match miss), templated here per docs/design/0018.
    if (!record) {
        return "Doesn't match this event";
    }
    const required = MATCHER_RULE_REQUIRED_FIELDS[record.matcherRule];
    const clauses: string[] = [];
    if (required.includes('eventCategory')) {
        clauses.push(`Category is ${record.eventCategory ?? '—'}`);
    }
    if (required.includes('event')) {
        clauses.push(`event is ${record.event ?? '—'}`);
    }
    if (clauses.length === 0) {
        return "Doesn't match this event";
    }
    return clauses.length === 1 ? clauses[0] : `${clauses[0]}, ${clauses[1]}`;
}
