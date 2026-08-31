/**
 * Pure state machine for the SObject Bindings sheet's commit-order drag-and-drop (Stage 3 of
 * docs/design/0017). Both the pointer drag handle and the keyboard Move Up/Down buttons call the same
 * `moveUp`/`moveDown`/`moveTo` — there is exactly one reorder path, just two ways to trigger it. Kept
 * free of Svelte/DOM so the whole state machine can be unit-tested with plain Vitest.
 *
 * Only SObjects that already have a Unit of Work binding participate — an SObject with no Unit of Work
 * binding at all has no sequence to reorder (that's what the card's own "Add" link is for, see
 * `sobjectBindingsView.ts`). A card whose Unit of Work binding exists but has a blank sequence *does*
 * participate — dragging it in is exactly how it gets a position, per the canvas's own 1b note ("a drag
 * onto a numbered row is what assigns it a position").
 */

export type ReorderCard = {
    /** Composite identity — mirrors `applicationFactoryView.ts`'s own `developerName + source` key. */
    developerName: string;
    source: string;
    sobject: string;
};

export type PendingChange = {
    developerName: string;
    source: string;
    sobject: string;
    fromSequence: number | undefined;
    toSequence: number;
};

export type ReorderState = {
    /** Current order, one entry per participating card. */
    order: ReorderCard[];
    /** The order at `initReorder` time — what `revert` restores. */
    initialOrder: ReorderCard[];
    /** This card's sequence right now — unchanged (may be `undefined`) for a card that hasn't moved this session. */
    effectiveSequence: Map<string, number | undefined>;
    /** The sequence each card actually holds on disk/in the org — compared against `effectiveSequence` to derive `pendingChanges`, never itself mutated. */
    startingSequence: Map<string, number | undefined>;
};

const SEQUENCE_STEP = 10;

function cardKey(card: Pick<ReorderCard, 'developerName' | 'source'>): string {
    return `${card.developerName} ${card.source}`;
}

/**
 * Seeds reorder state from the sheet's current Unit of Work rows, in their current commit order —
 * ascending by sequence, with equal/unsequenced rows keeping the scan's own relative order (the same
 * tie-break `commitPositions` already renders as a shared position label).
 */
export function initReorder(cards: (ReorderCard & { sequence: number | undefined })[]): ReorderState {
    const order = cards
        .map((card, index) => ({ card, index }))
        .sort((a, b) => {
            const aSeq = a.card.sequence ?? Number.POSITIVE_INFINITY;
            const bSeq = b.card.sequence ?? Number.POSITIVE_INFINITY;
            return aSeq !== bSeq ? aSeq - bSeq : a.index - b.index;
        })
        .map(({ card }): ReorderCard => ({ developerName: card.developerName, source: card.source, sobject: card.sobject }));

    const startingSequence = new Map(cards.map((card) => [cardKey(card), card.sequence]));
    return { order, initialOrder: order, effectiveSequence: new Map(startingSequence), startingSequence };
}

/**
 * A sequence strictly between `left` and `right`, or `undefined` when there's no integer room (or
 * neither bound exists) — the caller's cue to fall back to a full renumber. `undefined` on either side
 * means "no bound there" (the edge of the list, or a neighbor that's itself unsequenced).
 */
function midpoint(left: number | undefined, right: number | undefined): number | undefined {
    if (left === undefined && right === undefined) {
        return SEQUENCE_STEP;
    }
    if (left === undefined) {
        // No lower bound at all (the top of the list, or a never-moved unsequenced neighbor) — anything
        // below `right` works, so there's no "no room" case to fall back from here.
        const half = Math.floor(right! / 2);
        return half < right! ? half : right! - 1;
    }
    if (right === undefined) {
        return left + SEQUENCE_STEP;
    }
    const mid = Math.floor((left + right) / 2);
    return mid > left && mid < right ? mid : undefined;
}

/**
 * Moves the card at `fromIndex` to `toIndex` (clamped in range; a no-op move returns `state` unchanged
 * by reference, so callers can skip re-rendering). Assigns the moved card a fresh sequence at the
 * midpoint of its new neighbors' *current* sequence — so a single drag between two already-spaced cards
 * touches only that one card. When there's no integer room (deeply nested drags, or both neighbors
 * unsequenced), the whole order is rebalanced onto a fresh `10, 20, 30, ...` ladder instead — a rarer,
 * honestly-larger diff rather than a silent collision.
 */
export function moveTo(state: ReorderState, fromIndex: number, toIndex: number): ReorderState {
    const clampedTo = Math.max(0, Math.min(state.order.length - 1, toIndex));
    if (fromIndex < 0 || fromIndex >= state.order.length || clampedTo === fromIndex) {
        return state;
    }

    const order = [...state.order];
    const [moved] = order.splice(fromIndex, 1);
    order.splice(clampedTo, 0, moved);

    const movedKey = cardKey(moved);
    const newIndex = order.indexOf(moved);
    const leftSeq = newIndex > 0 ? state.effectiveSequence.get(cardKey(order[newIndex - 1])) : undefined;
    const rightSeq = newIndex < order.length - 1 ? state.effectiveSequence.get(cardKey(order[newIndex + 1])) : undefined;

    const newSeq = midpoint(leftSeq, rightSeq);
    const effectiveSequence =
        newSeq === undefined
            ? new Map(order.map((card, i) => [cardKey(card), (i + 1) * SEQUENCE_STEP]))
            : new Map(state.effectiveSequence).set(movedKey, newSeq);

    return { ...state, order, effectiveSequence };
}

/** Moves the card at `index` one position earlier. No-op at the first position. */
export function moveUp(state: ReorderState, index: number): ReorderState {
    return moveTo(state, index, index - 1);
}

/** Moves the card at `index` one position later. No-op at the last position. */
export function moveDown(state: ReorderState, index: number): ReorderState {
    return moveTo(state, index, index + 1);
}

/** Undoes every staged move, back to the state `initReorder` produced. */
export function revert(state: ReorderState): ReorderState {
    return { ...state, order: state.initialOrder, effectiveSequence: new Map(state.startingSequence) };
}

/**
 * Cards whose sequence actually differs from what's on disk right now — the Save bar's own list.
 * Compared against `startingSequence` (captured once, never updated as moves stage), so a card moved
 * away and then back within one editing session reports no pending change rather than a false "moved."
 */
export function pendingChanges(state: ReorderState): PendingChange[] {
    const changes: PendingChange[] = [];
    for (const card of state.order) {
        const key = cardKey(card);
        const toSequence = state.effectiveSequence.get(key);
        const fromSequence = state.startingSequence.get(key);
        if (toSequence !== fromSequence) {
            changes.push({ developerName: card.developerName, source: card.source, sobject: card.sobject, fromSequence, toSequence: toSequence as number });
        }
    }
    return changes;
}

export function isDirty(state: ReorderState): boolean {
    return pendingChanges(state).length > 0;
}

/** 1-based commit position of `developerName`/`source` in `order`, or `undefined` if it isn't in this reorder set at all. */
export function positionOf(order: ReorderCard[], developerName: string, source: string): number | undefined {
    const index = order.findIndex((card) => card.developerName === developerName && card.source === source);
    return index === -1 ? undefined : index + 1;
}
