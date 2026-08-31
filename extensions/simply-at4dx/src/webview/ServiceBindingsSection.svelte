<script lang="ts">
    import ApplicationFactoryRow from './ApplicationFactoryRow.svelte';
    import { buildApplicationFactorySections, groupsByKey } from './lib/applicationFactoryView';
    import type { ApplicationFactoryViewRow } from './lib/applicationFactoryView';
    import type { At4dxBindingRow } from './types';

    let {
        rows,
        canWrite,
        onEdit,
    }: { rows: At4dxBindingRow[]; canWrite: boolean; onEdit: (row: ApplicationFactoryViewRow) => void } = $props();

    // Service is the only binding type on this tab (it has no SObject to group by — see docs/design/0017),
    // so its section is always exactly one or none. Reuses `buildApplicationFactorySections`'s existing
    // resolution derivation rather than re-deriving Service's priority/tie logic here.
    let serviceRows = $derived(buildApplicationFactorySections(rows).find((section) => section.bindingType === 'Service')?.rows ?? []);

    function isTiedGroup(groupRows: ApplicationFactoryViewRow[]): boolean {
        return groupRows.some((row) => row.resolution.kind === 'tie-winner' || row.resolution.kind === 'tie-other');
    }
</script>

{#if serviceRows.length === 0}
    <p class="empty">No Service bindings found.</p>
{:else}
    <div class="section">
        <div class="section-header">
            <span class="section-title">Service</span>
            <span class="section-count">{serviceRows.length} binding{serviceRows.length === 1 ? '' : 's'}</span>
        </div>
        <div class="col-header af-row-grid">
            <span>Interface</span>
            <span></span>
            <span>Implementation</span>
            <span>Priority</span>
            <span>Package</span>
            <span>Resolution</span>
            <span></span>
        </div>
        {#each groupsByKey(serviceRows) as group (group.key)}
            {#if isTiedGroup(group.rows)}
                <div class="af-tie-banner">
                    ⚠ Tied on priority — AT4DX's resolution order for <strong>{group.key}</strong> isn't guaranteed to stay the same across deploys.
                </div>
            {/if}
            {#each group.rows as row (row.developerName + row.source)}
                <ApplicationFactoryRow {row} showPriority={true} {canWrite} {onEdit} />
            {/each}
        {/each}
    </div>
{/if}
