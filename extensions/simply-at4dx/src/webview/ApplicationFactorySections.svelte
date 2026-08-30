<script lang="ts">
    import ApplicationFactoryRow from './ApplicationFactoryRow.svelte';
    import { groupsByKey } from './lib/applicationFactoryView';
    import type { ApplicationFactorySection, ApplicationFactoryViewRow } from './lib/applicationFactoryView';

    let { sections }: { sections: ApplicationFactorySection[] } = $props();

    function isTiedGroup(rows: ApplicationFactoryViewRow[]): boolean {
        return rows.some((row) => row.resolution.kind === 'tie-winner' || row.resolution.kind === 'tie-other');
    }
</script>

{#if sections.length === 0}
    <p class="empty">No Application Factory bindings found.</p>
{:else}
    {#each sections as section (section.bindingType)}
        <div class="section">
            <div class="section-header">
                <span class="section-title">{section.bindingType}</span>
                <span class="section-count">{section.rows.length} binding{section.rows.length === 1 ? '' : 's'}</span>
            </div>
            {#if section.rows.length > 0}
                <div class="col-header af-row-grid" class:no-priority={!section.showPriority}>
                    <span>{section.keyHeader}</span>
                    <span></span>
                    <span>Implementation</span>
                    {#if section.showPriority}<span>Priority</span>{/if}
                    <span>Package</span>
                    <span>Resolution</span>
                    <span></span>
                </div>
            {/if}
            {#each groupsByKey(section.rows) as group (group.key)}
                {#if isTiedGroup(group.rows)}
                    <div class="af-tie-banner">
                        ⚠ Tied on priority — AT4DX's resolution order for <strong>{group.key}</strong> isn't guaranteed to stay the same across deploys.
                    </div>
                {/if}
                {#each group.rows as row (row.developerName + row.source)}
                    <ApplicationFactoryRow {row} showPriority={section.showPriority} />
                {/each}
            {/each}
        </div>
    {/each}
{/if}
