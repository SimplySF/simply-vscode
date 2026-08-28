<script lang="ts">
    import BindingRow from './BindingRow.svelte';
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
</script>

{#if sections.length === 0}
    <p class="empty">No bindings found for this selection.</p>
{:else}
    {#each sections as section (section.title)}
        <div class="section">
            <div class="section-header">
                <span class="section-title">{section.title}</span>
                <span class="section-count">{section.rows.length} Item(s) &middot; Sorted By Order of Execution</span>
            </div>
            {#if section.rows.length > 0}
                <div class="col-header row-grid">
                    <span>Order</span><span>Type</span><span>Class to Inject</span><span>Recursion</span><span>Logical Inverse</span><span>Status</span><span></span>
                </div>
            {/if}
            {#each section.rows as row (row.developerName + row.source)}
                <BindingRow {row} badges={issuesByRecord.get(`${row.developerName} ${row.source}`) ?? []} {rules} {onEdit} />
            {/each}
        </div>
    {/each}
{/if}
