<script lang="ts">
    import type { UnitOfWorkViewRow } from './lib/applicationFactoryView';

    let { rows }: { rows: UnitOfWorkViewRow[] } = $props();
</script>

{#if rows.length === 0}
    <p class="empty">No Unit of Work bindings found.</p>
{:else}
    <div class="section">
        <div class="section-header">
            <span class="section-title">UnitOfWork</span>
            <span class="section-count">{rows.length} SObject{rows.length === 1 ? '' : 's'} &middot; commit order</span>
        </div>
        <div class="col-header uow-row-grid">
            <span>SObject</span>
            <span>Sequence</span>
            <span>Commits</span>
            <span>Package</span>
        </div>
        {#each rows as row (row.developerName + row.source)}
            <div class="row uow-row-grid">
                <span title={row.key}>{row.key}</span>
                <span class="af-priority" class:af-priority-blank={row.sequence === undefined}>{row.sequence ?? '—'}</span>
                <span>{row.commitPosition ?? 'unordered — no sequence set'}</span>
                <span title={row.source}>{row.source}</span>
            </div>
        {/each}
    </div>
{/if}
