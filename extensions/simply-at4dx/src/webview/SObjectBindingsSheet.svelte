<script lang="ts">
    import { untrack } from 'svelte';
    import PendingChangesBar from './PendingChangesBar.svelte';
    import SObjectBindingCard from './SObjectBindingCard.svelte';
    import { ordinal } from './lib/applicationFactoryView';
    import { initReorder, moveDown, moveTo, moveUp, pendingChanges, revert, type ReorderState } from './lib/dragReorder';
    import { activeFieldSetInclusionsForSObject } from './lib/fieldSetInclusionView';
    import { buildSObjectBindingCards, type SObjectBindingCard as SObjectBindingCardData } from './lib/sobjectBindingsView';
    import type { ApplicationFactoryViewRow, UnitOfWorkViewRow } from './lib/applicationFactoryView';
    import type { At4dxBindingRow, DomainProcessBindingRow, RawFieldSetInclusionRecord, SequenceBatchResult } from './types';
    import { postMessage } from './vscodeApi';

    let {
        rows,
        domainProcessRows,
        fieldSetInclusions,
        canWrite,
        lastBatchResult,
        onEdit,
        onAdd,
    }: {
        rows: At4dxBindingRow[];
        /** `undefined` while the Domain Process explorer's own (separately-scanned) data hasn't resolved yet. */
        domainProcessRows: DomainProcessBindingRow[] | undefined;
        /** For the "N field sets" count on each Selector row — see docs/design/0017's Stage 4. */
        fieldSetInclusions: RawFieldSetInclusionRecord[];
        canWrite: boolean;
        /** The just-finished "Save commit order" batch's outcome, present for this one mount only — see `at4dxExplorerPanel.ts`'s `render`. See docs/design/0017's Stage 3. */
        lastBatchResult: SequenceBatchResult | undefined;
        onEdit: (row: ApplicationFactoryViewRow | UnitOfWorkViewRow) => void;
        onAdd: (bindingType: 'Domain' | 'UnitOfWork', sobject: string) => void;
    } = $props();

    let cards = $derived(buildSObjectBindingCards(rows));

    /** Active field set inclusions, grouped by SObject — rendered as nested rows under a card's Selector row(s), canvas 3a's own "nest under a Selector row" treatment (docs/design/0017's Stage 4). */
    let fieldSetInclusionsBySObject = $derived.by(() => {
        const bySObject = new Map<string, RawFieldSetInclusionRecord[]>();
        for (const card of cards) {
            bySObject.set(card.sobject, activeFieldSetInclusionsForSObject(fieldSetInclusions, card.sobject));
        }
        return bySObject;
    });

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

    /** A card's Unit of Work row, if it has one — the only cards that take part in commit-order reordering. */
    function unitOfWorkRow(card: SObjectBindingCardData): UnitOfWorkViewRow | undefined {
        for (const cardRow of card.rows) {
            if (cardRow.kind === 'unit-of-work') {
                return cardRow.row;
            }
        }
        return undefined;
    }

    // `cards` never changes after mount in this codebase's architecture (the whole webview remounts per
    // state change — see docs/design/0011 — `rows` is never handed updated props in place), so this seeds
    // once via `untrack` rather than re-seeding (and losing every staged move) on each reactive recompute.
    let reorder = $state<ReorderState>(
        initReorder(
            untrack(() => cards)
                .map((card) => {
                    const uow = unitOfWorkRow(card);
                    return uow ? { developerName: uow.developerName, source: uow.source, sobject: card.sobject, sequence: uow.sequence } : undefined;
                })
                .filter((c): c is NonNullable<typeof c> => c !== undefined),
        ),
    );

    let pending = $derived(pendingChanges(reorder));

    /** Display order: participating cards in their live (possibly-dragged) order, then every other card unchanged. */
    let orderedCards = $derived.by(() => {
        const bySObject = new Map(cards.map((card) => [card.sobject, card]));
        const participating = new Set(reorder.order.map((c) => c.sobject));
        const tail = cards.filter((card) => !participating.has(card.sobject));
        return [...reorder.order.map((rc) => bySObject.get(rc.sobject)).filter((c): c is SObjectBindingCardData => c !== undefined), ...tail];
    });

    /** Adjacent participating cards sharing an effective sequence — the `sequence-collision` warning, folded in from canvas 1b (deviation 5 in docs/design/0017). Never blocks a drag or a save. */
    let collisionAfterSObject = $derived.by(() => {
        const collisions = new Set<string>();
        for (let i = 0; i < reorder.order.length - 1; i++) {
            const a = reorder.effectiveSequence.get(`${reorder.order[i].developerName} ${reorder.order[i].source}`);
            const b = reorder.effectiveSequence.get(`${reorder.order[i + 1].developerName} ${reorder.order[i + 1].source}`);
            if (a !== undefined && a === b) {
                collisions.add(reorder.order[i].sobject);
            }
        }
        return collisions;
    });

    let draggingSObject = $state<string | undefined>(undefined);
    let liveMessage = $state('');
    let saving = $state(false);
    let batchWriteError = $state<string | undefined>(undefined);

    // A successful batch always ends in a fresh rescan-and-render (this component unmounts), same as
    // every other write in this panel — except when that rescan *itself* fails, which posts `writeError`
    // back to this still-mounted sheet instead. Without this listener `saving` would stay stuck `true`
    // forever with no explanation, the same failure mode `ApplicationFactoryForm.svelte`'s own listener
    // already guards against for the create/edit drawer.
    $effect(() => {
        function onMessage(event: MessageEvent): void {
            const message = event.data as { command?: string; message?: string };
            if (message.command === 'writeError') {
                saving = false;
                batchWriteError = message.message ?? '';
            }
        }
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    });

    function participatingIndex(sobject: string): number | undefined {
        const index = reorder.order.findIndex((c) => c.sobject === sobject);
        return index === -1 ? undefined : index;
    }

    function announceMove(sobject: string): void {
        const index = participatingIndex(sobject);
        liveMessage = index === undefined ? '' : `${sobject} moved to ${ordinal(index + 1)} of ${reorder.order.length}`;
    }

    function handleMoveUp(sobject: string): void {
        const index = participatingIndex(sobject);
        if (index === undefined) {
            return;
        }
        reorder = moveUp(reorder, index);
        announceMove(sobject);
    }

    function handleMoveDown(sobject: string): void {
        const index = participatingIndex(sobject);
        if (index === undefined) {
            return;
        }
        reorder = moveDown(reorder, index);
        announceMove(sobject);
    }

    function handleDragStart(sobject: string): void {
        draggingSObject = sobject;
    }

    function handleDragEnd(): void {
        draggingSObject = undefined;
    }

    function handleDropOn(targetSObject: string): void {
        const from = draggingSObject;
        draggingSObject = undefined;
        if (!from || from === targetSObject) {
            return;
        }
        const fromIndex = participatingIndex(from);
        const toIndex = participatingIndex(targetSObject);
        if (fromIndex === undefined || toIndex === undefined) {
            return;
        }
        reorder = moveTo(reorder, fromIndex, toIndex);
        announceMove(from);
    }

    function handleRevert(): void {
        reorder = revert(reorder);
        liveMessage = 'Commit order reorder reverted.';
    }

    function handleSave(): void {
        saving = true;
        postMessage({
            command: 'submitSequenceBatch',
            updates: pending.map((change) => ({ developerName: change.developerName, sobject: change.sobject, sequence: change.toSequence })),
        });
    }
</script>

{#if cards.length === 0}
    <p class="empty">No SObject bindings found.</p>
{:else}
    {#if lastBatchResult}
        {#if lastBatchResult.failed}
            <div class="pcb-batch-result failed">
                Saved {lastBatchResult.savedCount} of {lastBatchResult.totalCount} pending move{lastBatchResult.totalCount === 1 ? '' : 's'} —
                <strong>{lastBatchResult.failed.sobject}</strong> failed: {lastBatchResult.failed.message}
                {#if lastBatchResult.savedCount + 1 < lastBatchResult.totalCount}The rest weren't attempted.{/if}
            </div>
        {:else}
            <div class="pcb-batch-result ok">Saved {lastBatchResult.savedCount} of {lastBatchResult.totalCount} pending move{lastBatchResult.totalCount === 1 ? '' : 's'}.</div>
        {/if}
    {/if}

    {#if batchWriteError}
        <div class="form-error">{#each batchWriteError.split('\n') as line, i (i)}{#if i > 0}<br />{/if}{line}{/each}</div>
    {/if}

    {#if canWrite}
        <PendingChangesBar {pending} order={reorder.order} initialOrder={reorder.initialOrder} {saving} onRevert={handleRevert} onSave={handleSave} />
    {/if}

    <div class="sr-only" aria-live="polite">{liveMessage}</div>

    <div class="sb-sheet">
        {#each orderedCards as card (card.sobject)}
            {@const uow = unitOfWorkRow(card)}
            {@const canReorder = canWrite && uow !== undefined}
            {@const index = participatingIndex(card.sobject)}
            <SObjectBindingCard
                {card}
                {canWrite}
                domainProcessBindingCount={domainProcessRows ? (domainProcessCountBySObject.get(card.sobject) ?? 0) : undefined}
                fieldSetInclusions={fieldSetInclusionsBySObject.get(card.sobject) ?? []}
                {onEdit}
                {onAdd}
                {canReorder}
                commitPosition={index === undefined ? undefined : ordinal(index + 1)}
                canMoveUp={canReorder && index !== undefined && index > 0}
                canMoveDown={canReorder && index !== undefined && index < reorder.order.length - 1}
                dragging={draggingSObject === card.sobject}
                onMoveUp={() => handleMoveUp(card.sobject)}
                onMoveDown={() => handleMoveDown(card.sobject)}
                onDragStart={() => handleDragStart(card.sobject)}
                onDragEnd={handleDragEnd}
                onDropOn={() => handleDropOn(card.sobject)}
            />
            {#if collisionAfterSObject.has(card.sobject)}
                {@const seq = reorder.effectiveSequence.get(`${uow?.developerName} ${uow?.source}`)}
                <div class="sb-collision-banner">
                    ⚠ sequence-collision — two records share <code>BindingSequence__c {seq}</code>. Both SObjects are registered; only their order relative to
                    each other is indeterminate.
                </div>
            {/if}
        {/each}
    </div>
{/if}
