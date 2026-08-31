<script lang="ts">
    import { ordinal } from './lib/applicationFactoryView';
    import { positionOf } from './lib/dragReorder';
    import type { PendingChange, ReorderCard } from './lib/dragReorder';

    let {
        pending,
        order,
        initialOrder,
        saving,
        onRevert,
        onSave,
    }: {
        pending: PendingChange[];
        order: ReorderCard[];
        initialOrder: ReorderCard[];
        saving: boolean;
        onRevert: () => void;
        onSave: () => void;
    } = $props();

    function positionLabel(change: PendingChange, list: ReorderCard[]): string {
        const pos = positionOf(list, change.developerName, change.source);
        return pos === undefined ? '—' : ordinal(pos);
    }
</script>

{#if pending.length > 0}
    <div class="pcb-bar">
        <div class="pcb-summary-row">
            <span class="pcb-dot"></span>
            <span class="pcb-summary">
                {pending.length} pending change{pending.length === 1 ? '' : 's'}
                {#if pending.length === 1}
                    — <strong>{pending[0].sobject}</strong> commits {positionLabel(pending[0], order)}, was {positionLabel(pending[0], initialOrder)}
                {/if}
            </span>
            <span class="pcb-spacer"></span>
            <button type="button" class="secondary" disabled={saving} onclick={onRevert}>Revert</button>
            <button type="button" disabled={saving} onclick={onSave}>{saving ? 'Saving…' : 'Save commit order'}</button>
        </div>
        {#if pending.length > 1}
            <ul class="pcb-list">
                {#each pending as change (change.developerName + change.source)}
                    <li><strong>{change.sobject}</strong> commits {positionLabel(change, order)}, was {positionLabel(change, initialOrder)}</li>
                {/each}
            </ul>
        {/if}
    </div>
{/if}
