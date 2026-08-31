<script lang="ts">
    import Icon from './Icon.svelte';
    import type { UnitOfWorkViewRow } from './lib/applicationFactoryView';

    let { rows, canWrite, onEdit }: { rows: UnitOfWorkViewRow[]; canWrite: boolean; onEdit: (row: UnitOfWorkViewRow) => void } = $props();

    function editClick(row: UnitOfWorkViewRow, event: MouseEvent): void {
        event.stopPropagation();
        onEdit(row);
    }

    function editKeydown(row: UnitOfWorkViewRow, event: KeyboardEvent): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onEdit(row);
        }
    }
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
            <span></span>
        </div>
        {#each rows as row (row.developerName + row.source)}
            <div class="row uow-row-grid">
                <span title={row.key}>{row.key}</span>
                <span class="af-priority" class:af-priority-blank={row.sequence === undefined}>{row.sequence ?? '—'}</span>
                <span>{row.commitPosition ?? 'unordered — no sequence set'}</span>
                <span title={row.source}>{row.source}</span>
                {#if canWrite}
                    <span class="row-edit" title="Edit this binding" role="button" tabindex="0" onclick={(event) => editClick(row, event)} onkeydown={(event) => editKeydown(row, event)}>
                        <Icon name="edit" />
                    </span>
                {:else}
                    <span></span>
                {/if}
            </div>
        {/each}
    </div>
{/if}
