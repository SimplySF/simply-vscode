<script lang="ts">
    import SObjectBindingCard from './SObjectBindingCard.svelte';
    import { buildSObjectBindingCards } from './lib/sobjectBindingsView';
    import type { ApplicationFactoryViewRow, UnitOfWorkViewRow } from './lib/applicationFactoryView';
    import type { At4dxBindingRow, DomainProcessBindingRow } from './types';

    let {
        rows,
        domainProcessRows,
        canWrite,
        onEdit,
        onAdd,
    }: {
        rows: At4dxBindingRow[];
        /** `undefined` while the Domain Process explorer's own (separately-scanned) data hasn't resolved yet. */
        domainProcessRows: DomainProcessBindingRow[] | undefined;
        canWrite: boolean;
        onEdit: (row: ApplicationFactoryViewRow | UnitOfWorkViewRow) => void;
        onAdd: (bindingType: 'Domain' | 'UnitOfWork', sobject: string) => void;
    } = $props();

    let cards = $derived(buildSObjectBindingCards(rows));

    let domainProcessCountBySObject = $derived.by(() => {
        const counts = new Map<string, number>();
        if (!domainProcessRows) {
            return counts;
        }
        for (const row of domainProcessRows) {
            counts.set(row.sobject, (counts.get(row.sobject) ?? 0) + 1);
        }
        return counts;
    });
</script>

{#if cards.length === 0}
    <p class="empty">No SObject bindings found.</p>
{:else}
    <div class="sb-sheet">
        {#each cards as card (card.sobject)}
            <SObjectBindingCard
                {card}
                {canWrite}
                domainProcessBindingCount={domainProcessRows ? (domainProcessCountBySObject.get(card.sobject) ?? 0) : undefined}
                {onEdit}
                {onAdd}
            />
        {/each}
    </div>
{/if}
