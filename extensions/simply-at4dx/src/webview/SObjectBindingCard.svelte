<script lang="ts">
    import Icon from './Icon.svelte';
    import type { SObjectBindingCard } from './lib/sobjectBindingsView';
    import { fieldSetCountLabel } from './lib/fieldSetInclusionView';
    import type { ApplicationFactoryViewRow, UnitOfWorkViewRow } from './lib/applicationFactoryView';
    import { postMessage } from './vscodeApi';

    let {
        card,
        canWrite,
        domainProcessBindingCount,
        fieldSetCount,
        onEdit,
        onAdd,
        canReorder = false,
        commitPosition,
        canMoveUp = false,
        canMoveDown = false,
        dragging = false,
        onMoveUp,
        onMoveDown,
        onDragStart,
        onDragEnd,
        onDropOn,
    }: {
        card: SObjectBindingCard;
        canWrite: boolean;
        /** Count of this SObject's Domain Process bindings, from the other explorer's own scan — `undefined` while that scan hasn't resolved yet. See docs/design/0017. */
        domainProcessBindingCount: number | undefined;
        /** Active field set inclusions for this SObject (Stage 4) — shared across every Selector row on the card, since inclusions are SObject-scoped rather than tied to one binding. */
        fieldSetCount: number;
        onEdit: (row: ApplicationFactoryViewRow | UnitOfWorkViewRow) => void;
        onAdd: (bindingType: 'Domain' | 'UnitOfWork', sobject: string) => void;
        /** Whether this card has a real Unit of Work binding and so takes part in commit-order drag/keyboard reordering (Stage 3). */
        canReorder?: boolean;
        /** This card's live commit position ("1st", "2nd", ...), reflecting any staged-but-unsaved moves — `undefined` when `canReorder` is false. */
        commitPosition?: string;
        canMoveUp?: boolean;
        canMoveDown?: boolean;
        /** Whether this card is the one currently being pointer-dragged — highlights it, matching 1a's mid-drag state. */
        dragging?: boolean;
        onMoveUp?: () => void;
        onMoveDown?: () => void;
        onDragStart?: () => void;
        onDragEnd?: () => void;
        /** Fires when another card is dropped on this one. */
        onDropOn?: () => void;
    } = $props();

    // WINS/SHADOWED (and the tie chips) only mean something when there's a second Selector on this same
    // SObject to compete against — canvas 1a's own solo-Selector example (Fish__c's FishSelector) shows
    // no badge at all, just the priority value. See docs/design/0017.
    let selectorCount = $derived(card.rows.filter((cardRow) => cardRow.kind === 'selector').length);

    // Every real (non-gap) row's status column: canvas 1a draws a green "Active" dot on every Selector,
    // Domain, and Unit of Work row. Unlike the write-side Active *checkbox* the design doc's own
    // deviation 1 already dropped (there's no isActive field to write for any of these types), this is a
    // read-only, unconditional label — every row here came back from `resolveBindings`, so it exists and
    // resolves; there's no "inactive" state a scanned record could be in for these three types to
    // distinguish it from. Showing it isn't a claim about a field that doesn't exist, just that the
    // record is live, which is always true for anything reaching this component at all.

    function dragOver(event: DragEvent): void {
        if (canReorder) {
            event.preventDefault();
        }
    }

    function drop(event: DragEvent): void {
        if (!canReorder) {
            return;
        }
        event.preventDefault();
        onDropOn?.();
    }

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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sb-card" class:sb-card-dragging={dragging} ondragover={dragOver} ondrop={drop}>
    <div class="sb-card-header">
        {#if canReorder}
            <!--
                Mouse/pointer-only, deliberately: the Move Up/Down buttons right next to this handle are
                the keyboard-operable equivalent (see docs/design/0017's Stage 3) — the drag handle itself
                is hidden from the accessibility tree rather than given a redundant, not-actually-operable
                keyboard affordance of its own.
            -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
                class="sb-drag-handle"
                title="Drag to reorder"
                aria-hidden="true"
                draggable="true"
                ondragstart={() => onDragStart?.()}
                ondragend={() => onDragEnd?.()}>⣿</span
            >
            <span class="sb-move-buttons">
                <button
                    type="button"
                    class="sb-move-btn"
                    disabled={!canMoveUp}
                    title="Move {card.sobject} earlier in the commit order"
                    aria-label="Move {card.sobject} earlier in the commit order"
                    onclick={() => onMoveUp?.()}><Icon name="moveUp" /></button
                >
                <button
                    type="button"
                    class="sb-move-btn"
                    disabled={!canMoveDown}
                    title="Move {card.sobject} later in the commit order"
                    aria-label="Move {card.sobject} later in the commit order"
                    onclick={() => onMoveDown?.()}><Icon name="moveDown" /></button
                >
            </span>
        {/if}
        <span class="sb-card-sobject">{card.sobject}</span>
        {#if card.gapCount > 0}
            <span class="sb-gap-pill">⚠ {card.gapCount} gap{card.gapCount === 1 ? '' : 's'}</span>
        {/if}
        <span class="sb-card-spacer"></span>
        <span class="sb-card-count">
            {#if commitPosition}commits {commitPosition} · {/if}{card.bindingCount} binding{card.bindingCount === 1 ? '' : 's'}
        </span>
    </div>
    {#each card.rows as cardRow, i (i)}
        {#if cardRow.kind === 'selector'}
            {@const row = cardRow.row}
            <div class="sb-row">
                <span class="af-type-pill af-type-selector">SELECTOR</span>
                <span class="row-class" role="button" tabindex="0" title={row.to} onclick={() => openClass(row.to)} onkeydown={(e) => classKeydown(row.to, e)}>
                    {row.to}
                </span>
                <span class="sb-detail">{fieldSetCountLabel(fieldSetCount)}</span>
                <span class="sb-value-badge">
                    <span class="af-priority" class:af-priority-blank={row.priority === undefined}>{row.priority ?? '—'}</span>
                    {#if selectorCount > 1}
                        {#if row.resolution.kind === 'effective'}
                            <span class="sb-badge sb-badge-wins">WINS</span>
                        {:else if row.resolution.kind === 'shadowed'}
                            <span class="sb-badge sb-badge-shadowed">SHADOWED</span>
                        {:else if row.resolution.kind === 'tie-winner'}
                            <span class="af-resolution-chip resolves-today">Resolves today</span>
                        {:else if row.resolution.kind === 'tie-other'}
                            <span class="af-resolution-chip">May win instead</span>
                        {/if}
                    {/if}
                </span>
                <span class="row-status">
                    <span class="status-indicator status-active"><span class="status-dot"></span>Active</span>
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
                <span class="row-status">
                    <span class="status-indicator status-active"><span class="status-dot"></span>Active</span>
                </span>
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
                <span class="row-status">
                    <span class="status-indicator status-active"><span class="status-dot"></span>Active</span>
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
