<script lang="ts">
    import {
        eventColumnState,
        groupPlatformEventSubscriptions,
        issuesByRecordKey,
        MATCHER_RULE_SHORT_LABEL,
        NEVER_FIRES_NOTE,
        problemCount,
        recordKey,
        rowStatus,
        throwsHazardNote,
    } from './lib/platformEventView';
    import type { PlatformEventSubscriptionIssue, RawPlatformEventSubscriptionRecord } from './types';

    let {
        records,
        issues,
        canWrite,
        onEdit,
    }: { records: RawPlatformEventSubscriptionRecord[]; issues: PlatformEventSubscriptionIssue[]; canWrite: boolean; onEdit: (record: RawPlatformEventSubscriptionRecord) => void } = $props();

    let issuesByKey = $derived(issuesByRecordKey(issues));
    let busGroups = $derived(groupPlatformEventSubscriptions(records));

    function pluralize(count: number, noun: string): string {
        return `${count} ${noun}${count === 1 ? '' : 's'}`;
    }

    function categoryCountLabel(count: number): string {
        return `${count} categor${count === 1 ? 'y' : 'ies'}`;
    }
</script>

<div class="pe-sheet">
    {#each busGroups as bus (bus.eventBus)}
        <div class="pe-bus">
            <div class="pe-bus-header">
                <span class="pe-bus-name">{bus.eventBus}</span>
                <span class="pe-bus-spacer"></span>
                <span class="pe-bus-count">{categoryCountLabel(bus.categoryCount)} · {pluralize(bus.recordCount, 'subscription')}</span>
            </div>
            {#each bus.categories as category (category.label)}
                {@const categoryProblems = problemCount(category.records, issuesByKey)}
                <div class="pe-category-header">
                    <span class="pe-category-label" class:pe-category-none={!category.category}>{category.label}</span>
                    <span class="pe-bus-spacer"></span>
                    <span class="pe-category-count">
                        {pluralize(category.records.length, 'subscription')}{#if categoryProblems > 0}
                            &nbsp;·&nbsp;{pluralize(categoryProblems, 'problem')}{/if}
                    </span>
                </div>
                <div class="pe-row pe-col-header">
                    <span>Type</span>
                    <span>Subscriber</span>
                    <span>Matches on</span>
                    <span>Event</span>
                    <span>Mode</span>
                    <span>Status</span>
                    <span></span>
                </div>
                {#each category.records as record (recordKey(record))}
                    {@const status = rowStatus(record, issuesByKey.get(recordKey(record)) ?? [])}
                    {@const eventState = eventColumnState(record)}
                    <div class="pe-row" class:pe-row-throws={status === 'throws'} class:pe-row-never-fires={status === 'never-fires'} class:pe-row-inactive={status === 'inactive'}>
                        <span class="pe-type-pill">SUBSCRIBER</span>
                        <span class="row-class-static">{record.consumer}</span>
                        <span class="sb-detail">{MATCHER_RULE_SHORT_LABEL[record.matcherRule]}</span>
                        {#if eventState.kind === 'value'}
                            <span class="pe-event-value">{eventState.text}</span>
                        {:else if eventState.kind === 'any'}
                            <span class="pe-event-any">any</span>
                        {:else}
                            <span class="pe-event-blank">⚠ blank</span>
                        {/if}
                        {#if record.executeSynchronous}
                            <span class="pe-mode">sync</span>
                        {:else}
                            <span class="pe-mode pe-mode-async">⟳ async</span>
                        {/if}
                        <span class="status-indicator" class:status-active={status === 'active'} class:pe-status-throws={status === 'throws'} class:pe-status-never-fires={status === 'never-fires'}>
                            <span class="status-dot"></span>
                            {#if status === 'active'}Active{:else if status === 'inactive'}Inactive{:else if status === 'throws'}Throws{:else}Never fires{/if}
                        </span>
                        {#if canWrite}
                            <button type="button" class="row-edit" aria-label="Edit {record.developerName}" onclick={() => onEdit(record)}>✎</button>
                        {:else}
                            <span></span>
                        {/if}
                    </div>
                    {#if status === 'throws'}
                        {@const note = throwsHazardNote(record)}
                        {#if note}
                            <div class="pe-hazard-note pe-hazard-error"><strong>{note.lead}</strong> {note.body}</div>
                        {/if}
                    {:else if status === 'never-fires'}
                        <div class="pe-hazard-note pe-hazard-warning"><strong>{NEVER_FIRES_NOTE.lead}</strong> {NEVER_FIRES_NOTE.body}</div>
                    {/if}
                {/each}
            {/each}
        </div>
    {/each}
</div>
