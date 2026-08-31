<script lang="ts">
    import Icon from './Icon.svelte';
    import { planUnitOfWorkReorder, unitOfWorkCollisionGroups } from './lib/applicationFactoryView';
    import type { UnitOfWorkViewRow } from './lib/applicationFactoryView';
    import { postMessage } from './vscodeApi';

    let { rows, canWrite, onEdit }: { rows: UnitOfWorkViewRow[]; canWrite: boolean; onEdit: (row: UnitOfWorkViewRow) => void } = $props();

    let collisionGroups = $derived(unitOfWorkCollisionGroups(rows));
    let firstOfGroupKeys = $derived(new Set(collisionGroups.map((group) => rowKey(group.rows[0]))));

    function rowKey(row: UnitOfWorkViewRow): string {
        return `${row.developerName} ${row.source}`;
    }

    function isFirstOfCollisionGroup(row: UnitOfWorkViewRow): boolean {
        return firstOfGroupKeys.has(rowKey(row));
    }

    let draggedDeveloperName = $state<string | undefined>();

    function onDragStart(row: UnitOfWorkViewRow, event: DragEvent): void {
        draggedDeveloperName = row.developerName;
        event.dataTransfer?.setData('text/plain', row.developerName);
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
        }
    }

    function onDragOver(event: DragEvent): void {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    }

    function onDrop(targetIndex: number, event: DragEvent): void {
        event.preventDefault();
        const developerName = draggedDeveloperName ?? event.dataTransfer?.getData('text/plain');
        draggedDeveloperName = undefined;
        if (!developerName) {
            return;
        }
        const moves = planUnitOfWorkReorder(rows, developerName, targetIndex);
        if (moves.length > 0) {
            postMessage({ command: 'reorderUnitOfWork', moves });
        }
    }

    function onDragEnd(): void {
        draggedDeveloperName = undefined;
    }

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
        <div class="uow-toolbar">
            <span class="uow-toolbar-text">Drag to reorder — each move is one <span class="mono">binding update --sequence</span>.</span>
            <span class="uow-toolbar-spacer"></span>
            {#if collisionGroups.length > 0}
                <span class="uow-toolbar-warning">⚠ {collisionGroups.length} warning{collisionGroups.length === 1 ? '' : 's'}</span>
            {/if}
        </div>
        <div class="col-header uow-row-grid">
            <span></span>
            <span>SObject</span>
            <span>Sequence</span>
            <span>Commits</span>
            <span>Package</span>
            <span></span>
        </div>
        {#each rows as row, index (rowKey(row))}
            {#if isFirstOfCollisionGroup(row)}
                <div class="af-tie-banner">
                    <span class="af-tie-banner-icon">⚠</span>
                    <span class="af-tie-banner-text">
                        <span class="mono-strong">sequence-collision</span> — two records share <span class="mono">BindingSequence__c {row.sequence}</span>. Both
                        SObjects are registered; only their order relative to <em>each other</em> is indeterminate.
                    </span>
                </div>
            {/if}
            <div
                class="row uow-row-grid"
                role="listitem"
                class:uow-row-dragging={draggedDeveloperName === row.developerName}
                draggable={canWrite}
                ondragstart={(event) => onDragStart(row, event)}
                ondragover={onDragOver}
                ondrop={(event) => onDrop(index, event)}
                ondragend={onDragEnd}
            >
                <span class="uow-drag-handle" title={canWrite ? 'Drag to reorder' : undefined}>{canWrite ? '⋮⋮' : ''}</span>
                <span title={row.key}>{row.key}</span>
                <span class="af-priority" class:af-priority-blank={row.sequence === undefined} class:af-priority-tied={row.tied}>{row.sequence ?? '—'}</span>
                <span class:uow-commits-tied={row.tied} class:uow-commits-blank={row.sequence === undefined}>{row.commitPosition ?? 'unordered — no sequence set'}</span>
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
