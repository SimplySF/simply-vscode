<script lang="ts">
    import Icon from './Icon.svelte';
    import type { SObjectBindingCard } from './lib/sobjectBindingsView';
    import type { ApplicationFactoryViewRow, UnitOfWorkViewRow } from './lib/applicationFactoryView';
    import { postMessage } from './vscodeApi';

    let {
        card,
        canWrite,
        domainProcessBindingCount,
        onEdit,
        onAdd,
    }: {
        card: SObjectBindingCard;
        canWrite: boolean;
        /** Count of this SObject's Domain Process bindings, from the other explorer's own scan — `undefined` while that scan hasn't resolved yet. See docs/design/0017. */
        domainProcessBindingCount: number | undefined;
        onEdit: (row: ApplicationFactoryViewRow | UnitOfWorkViewRow) => void;
        onAdd: (bindingType: 'Domain' | 'UnitOfWork', sobject: string) => void;
    } = $props();

    function openClass(classToInject: string | undefined): void {
        if (classToInject) {
            postMessage({ command: 'openClass', classToInject });
        }
    }

    function classKeydown(classToInject: string | undefined, event: KeyboardEvent): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openClass(classToInject);
        }
    }

    function editClick(row: ApplicationFactoryViewRow | UnitOfWorkViewRow, event: MouseEvent): void {
        event.stopPropagation();
        onEdit(row);
    }

    function editKeydown(row: ApplicationFactoryViewRow | UnitOfWorkViewRow, event: KeyboardEvent): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onEdit(row);
        }
    }
</script>

<div class="sb-card">
    <div class="sb-card-header">
        <span class="sb-card-sobject">{card.sobject}</span>
        {#if card.gapCount > 0}
            <span class="sb-gap-pill">⚠ {card.gapCount} gap{card.gapCount === 1 ? '' : 's'}</span>
        {/if}
        <span class="sb-card-spacer"></span>
        <span class="sb-card-count">{card.bindingCount} binding{card.bindingCount === 1 ? '' : 's'}</span>
    </div>
    {#each card.rows as cardRow, i (i)}
        {#if cardRow.kind === 'selector'}
            {@const row = cardRow.row}
            <div class="sb-row">
                <span class="af-type-pill af-type-selector">SELECTOR</span>
                <span class="row-class" role="button" tabindex="0" title={row.to} onclick={() => openClass(row.to)} onkeydown={(e) => classKeydown(row.to, e)}>
                    {row.to}
                </span>
                <!-- Field set count is Stage 4 (docs/design/0017) — field set inclusion data isn't scanned yet. -->
                <span class="sb-detail"></span>
                <span class="sb-value-badge">
                    <span class="af-priority" class:af-priority-blank={row.priority === undefined}>{row.priority ?? '—'}</span>
                    {#if row.resolution.kind === 'effective'}
                        <span class="sb-badge sb-badge-wins">WINS</span>
                    {:else if row.resolution.kind === 'shadowed'}
                        <span class="sb-badge sb-badge-shadowed">SHADOWED</span>
                    {:else if row.resolution.kind === 'tie-winner'}
                        <span class="af-resolution-chip resolves-today">Resolves today</span>
                    {:else if row.resolution.kind === 'tie-other'}
                        <span class="af-resolution-chip">May win instead</span>
                    {/if}
                </span>
                {#if canWrite}
                    <span class="row-edit" title="Edit this binding" role="button" tabindex="0" onclick={(e) => editClick(row, e)} onkeydown={(e) => editKeydown(row, e)}>
                        <Icon name="edit" />
                    </span>
                {:else}
                    <span></span>
                {/if}
            </div>
        {:else if cardRow.kind === 'domain'}
            {@const row = cardRow.row}
            <div class="sb-row">
                <span class="af-type-pill af-type-domain">DOMAIN</span>
                <span class="row-class" role="button" tabindex="0" title={row.to} onclick={() => openClass(row.to)} onkeydown={(e) => classKeydown(row.to, e)}>
                    {row.to}
                </span>
                <span class="sb-detail">
                    {domainProcessBindingCount === undefined ? 'Domain process bindings' : `${domainProcessBindingCount} process binding${domainProcessBindingCount === 1 ? '' : 's'}`}
                </span>
                <span class="sb-value-badge"></span>
                {#if canWrite}
                    <span class="row-edit" title="Edit this binding" role="button" tabindex="0" onclick={(e) => editClick(row, e)} onkeydown={(e) => editKeydown(row, e)}>
                        <Icon name="edit" />
                    </span>
                {:else}
                    <span></span>
                {/if}
            </div>
        {:else if cardRow.kind === 'domain-gap'}
            <div class="sb-row sb-row-gap">
                <span class="af-type-pill af-type-domain af-type-pill-dashed">DOMAIN</span>
                <span class="sb-gap-message">Not bound — <span class="sb-gap-warning">⚠ domain process bindings won't resolve</span></span>
                {#if canWrite}
                    <button type="button" class="sb-add-link" onclick={() => onAdd('Domain', card.sobject)}>Add</button>
                {:else}
                    <span></span>
                {/if}
            </div>
        {:else if cardRow.kind === 'unit-of-work'}
            {@const row = cardRow.row}
            <div class="sb-row">
                <span class="af-type-pill af-type-uow">UNIT OF WORK</span>
                <span class="row-class row-class-static">
                    {row.commitPosition ? `Commits ${row.commitPosition} — from this card's position` : 'Unordered — no sequence set'}
                </span>
                <span class="sb-detail"></span>
                <span class="sb-value-badge">
                    <span class="af-priority" class:af-priority-blank={row.sequence === undefined}>{row.sequence !== undefined ? `seq ${row.sequence}` : '—'}</span>
                </span>
                {#if canWrite}
                    <span class="row-edit" title="Edit this binding" role="button" tabindex="0" onclick={(e) => editClick(row, e)} onkeydown={(e) => editKeydown(row, e)}>
                        <Icon name="edit" />
                    </span>
                {:else}
                    <span></span>
                {/if}
            </div>
        {:else if cardRow.kind === 'unit-of-work-gap'}
            <div class="sb-row sb-row-gap">
                <span class="af-type-pill af-type-uow af-type-pill-dashed">UNIT OF WORK</span>
                <span class="sb-gap-message">Not bound — this SObject doesn't join the shared Unit of Work</span>
                {#if canWrite}
                    <button type="button" class="sb-add-link" onclick={() => onAdd('UnitOfWork', card.sobject)}>Add</button>
                {:else}
                    <span></span>
                {/if}
            </div>
        {/if}
    {/each}
</div>
