<script lang="ts">
    import { SvelteSet } from 'svelte/reactivity';
    import BindingRow from './BindingRow.svelte';
    import { buildSequenceGroups } from './lib/bindingView';
    import type { BindingSection } from './lib/bindingView';
    import type { DomainProcessBindingRow, DomainProcessBindingRules, IndexedIssue } from './types';

    let {
        sections,
        issuesByRecord,
        rules,
        onEdit,
    }: {
        sections: BindingSection[];
        issuesByRecord: Map<string, IndexedIssue[]>;
        rules: DomainProcessBindingRules;
        onEdit: (row: DomainProcessBindingRow) => void;
    } = $props();

    let collapsed = $state(new SvelteSet<string>());

    const groupKey = (sectionTitle: string, label: string) => `${sectionTitle}:${label}`;

    function toggle(key: string): void {
        if (collapsed.has(key)) {
            collapsed.delete(key);
        } else {
            collapsed.add(key);
        }
    }

    function badgesFor(row: DomainProcessBindingRow): IndexedIssue[] {
        return issuesByRecord.get(`${row.developerName} ${row.source}`) ?? [];
    }

    function groupIssueCount(rows: DomainProcessBindingRow[]): number {
        return rows.reduce((n, row) => n + badgesFor(row).length, 0);
    }

    function groupHasError(rows: DomainProcessBindingRow[]): boolean {
        return rows.some((row) => badgesFor(row).some((entry) => entry.issue.severity === 'error'));
    }
</script>

{#if sections.length === 0}
    <p class="empty">No bindings found for this selection.</p>
{:else}
    {#each sections as section (section.title)}
        {@const groups = buildSequenceGroups(section.rows)}
        <div class="section">
            <div class="section-header">
                <span class="section-title">{section.title}</span>
                <span class="section-count">
                    {section.rows.length} Item(s)
                    {#if groups.length > 1}&middot; {groups.length} sequences{/if}
                    &middot; Sorted By Order of Execution
                </span>
            </div>
            {#if section.rows.length > 0}
                <div class="col-header row-grid" class:col-header-banded={groups.length > 1}>
                    <span>Order</span><span>Type</span><span>Class to Inject</span><span>Async</span><span>Recursion</span><span>Logical Inverse</span><span></span><span>Status</span><span></span>
                </div>
            {/if}

            {#if groups.length > 1}
                {#each groups as group (group.label)}
                    {@const key = groupKey(section.title, group.label)}
                    {@const isCollapsed = collapsed.has(key)}
                    {@const issueCount = groupIssueCount(group.rows)}
                    <div class="seq-group" class:seq-group-collapsed={isCollapsed}>
                        <button type="button" class="seq-caption" aria-expanded={!isCollapsed} onclick={() => toggle(key)}>
                            <span class="seq-chevron">{isCollapsed ? '▸' : '▾'}</span>
                            <span class="seq-prefix">{group.label}</span>
                            <span class="seq-summary">{group.summary}</span>
                            {#if issueCount > 0 && isCollapsed}
                                <span class="seq-issues" class:error={groupHasError(group.rows)}>&#9888; {issueCount}</span>
                            {/if}
                            <span class="seq-range">{group.range}</span>
                        </button>
                        {#if !isCollapsed}
                            {#each group.rows as row (row.developerName + row.source)}
                                <BindingRow {row} badges={badgesFor(row)} {rules} {onEdit} />
                            {/each}
                        {/if}
                    </div>
                {/each}
            {:else}
                {#each section.rows as row (row.developerName + row.source)}
                    <BindingRow {row} badges={badgesFor(row)} {rules} {onEdit} />
                {/each}
            {/if}
        </div>
    {/each}
{/if}
