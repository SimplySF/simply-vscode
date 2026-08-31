import { describe, expect, it } from 'vitest';
import { initReorder, isDirty, moveDown, moveTo, moveUp, pendingChanges, positionOf, revert, type ReorderCard } from '../../src/webview/lib/dragReorder';

function card(developerName: string, sobject: string, sequence: number | undefined): ReorderCard & { sequence: number | undefined } {
    return { developerName, source: 'local', sobject, sequence };
}

describe('initReorder', () => {
    it('orders by ascending sequence regardless of input order', () => {
        const state = initReorder([card('C', 'Contact', 30), card('A', 'Account', 10), card('F', 'Fish__c', 20)]);
        expect(state.order.map((c) => c.sobject)).toEqual(['Account', 'Fish__c', 'Contact']);
    });

    it('sorts unsequenced cards after every sequenced one, keeping their own relative order', () => {
        const state = initReorder([card('U1', 'Unsequenced1', undefined), card('A', 'Account', 10), card('U2', 'Unsequenced2', undefined)]);
        expect(state.order.map((c) => c.sobject)).toEqual(['Account', 'Unsequenced1', 'Unsequenced2']);
    });

    it('starts with no pending changes', () => {
        const state = initReorder([card('A', 'Account', 10), card('F', 'Fish__c', 20)]);
        expect(pendingChanges(state)).toEqual([]);
        expect(isDirty(state)).toBe(false);
    });
});

describe('moveTo / moveUp / moveDown', () => {
    it('moves a card between two well-spaced neighbors, touching only that card', () => {
        const state = initReorder([card('A', 'Account', 10), card('F', 'Fish__c', 20), card('C', 'Contact', 30)]);
        const moved = moveTo(state, 2, 0); // Contact to the front

        expect(moved.order.map((c) => c.sobject)).toEqual(['Contact', 'Account', 'Fish__c']);
        const changes = pendingChanges(moved);
        expect(changes).toHaveLength(1);
        expect(changes[0]).toEqual({ developerName: 'C', source: 'local', sobject: 'Contact', fromSequence: 30, toSequence: 5 });
    });

    it('moveDown swaps with the next card and assigns a midpoint sequence', () => {
        const state = initReorder([card('A', 'Account', 10), card('F', 'Fish__c', 20), card('C', 'Contact', 30)]);
        const moved = moveDown(state, 0); // Account after Fish__c

        expect(moved.order.map((c) => c.sobject)).toEqual(['Fish__c', 'Account', 'Contact']);
        expect(pendingChanges(moved)).toEqual([{ developerName: 'A', source: 'local', sobject: 'Account', fromSequence: 10, toSequence: 25 }]);
    });

    it('moveUp at index 0 is a no-op (returns the same state by reference)', () => {
        const state = initReorder([card('A', 'Account', 10), card('F', 'Fish__c', 20)]);
        expect(moveUp(state, 0)).toBe(state);
    });

    it('moveDown at the last index is a no-op', () => {
        const state = initReorder([card('A', 'Account', 10), card('F', 'Fish__c', 20)]);
        expect(moveDown(state, 1)).toBe(state);
    });

    it('moving a card to the very front with no lower bound halves the leading gap', () => {
        const state = initReorder([card('A', 'Account', 10), card('F', 'Fish__c', 20)]);
        const moved = moveTo(state, 1, 0);
        expect(pendingChanges(moved)).toEqual([{ developerName: 'F', source: 'local', sobject: 'Fish__c', fromSequence: 20, toSequence: 5 }]);
    });

    it('moving a card to the very end with no upper bound adds one step', () => {
        const state = initReorder([card('A', 'Account', 10), card('F', 'Fish__c', 20)]);
        const moved = moveTo(state, 0, 1);
        expect(pendingChanges(moved)).toEqual([{ developerName: 'A', source: 'local', sobject: 'Account', fromSequence: 10, toSequence: 30 }]);
    });

    it('falls back to a full renumber when neighbors leave no integer room', () => {
        const state = initReorder([card('A', 'Account', 10), card('F', 'Fish__c', 11), card('C', 'Contact', 30)]);
        // Move Contact between Account (10) and Fish__c (11) — no integer strictly between them.
        const moved = moveTo(state, 2, 1);

        expect(moved.order.map((c) => c.sobject)).toEqual(['Account', 'Contact', 'Fish__c']);
        const changes = pendingChanges(moved);
        // A full renumber touches every card whose fresh ladder position differs from its starting one.
        expect(changes.map((c) => c.sobject).sort()).toEqual(['Contact', 'Fish__c']);
        expect(changes.find((c) => c.sobject === 'Contact')?.toSequence).toBe(20);
        expect(changes.find((c) => c.sobject === 'Fish__c')?.toSequence).toBe(30);
    });

    it('inserting a card between two unsequenced ones lands it at the default step (no bound either side)', () => {
        const state = initReorder([card('A', 'Account', 10), card('U1', 'Unsequenced1', undefined), card('U2', 'Unsequenced2', undefined)]);
        const moved = moveTo(state, 2, 1); // Unsequenced2 between Account and Unsequenced1

        expect(moved.order.map((c) => c.sobject)).toEqual(['Account', 'Unsequenced2', 'Unsequenced1']);
        expect(pendingChanges(moved)).toEqual([{ developerName: 'U2', source: 'local', sobject: 'Unsequenced2', fromSequence: undefined, toSequence: 20 }]);
    });

    it('a round trip (A to B, then back to A) within one session reports no pending change', () => {
        const state = initReorder([card('A', 'Account', 10), card('F', 'Fish__c', 20), card('C', 'Contact', 30)]);
        const away = moveTo(state, 0, 2);
        const back = moveTo(away, away.order.findIndex((c) => c.sobject === 'Account'), 0);

        expect(back.order.map((c) => c.sobject)).toEqual(['Account', 'Fish__c', 'Contact']);
        expect(pendingChanges(back)).toEqual([]);
    });
});

describe('revert', () => {
    it('restores the initial order and clears every pending change', () => {
        const state = initReorder([card('A', 'Account', 10), card('F', 'Fish__c', 20), card('C', 'Contact', 30)]);
        const moved = moveDown(moveTo(state, 2, 0), 1);
        expect(isDirty(moved)).toBe(true);

        const reverted = revert(moved);
        expect(reverted.order.map((c) => c.sobject)).toEqual(['Account', 'Fish__c', 'Contact']);
        expect(pendingChanges(reverted)).toEqual([]);
    });
});

describe('positionOf', () => {
    it('is 1-based and undefined for a card not in the order', () => {
        const state = initReorder([card('A', 'Account', 10), card('F', 'Fish__c', 20)]);
        expect(positionOf(state.order, 'A', 'local')).toBe(1);
        expect(positionOf(state.order, 'F', 'local')).toBe(2);
        expect(positionOf(state.order, 'Nope', 'local')).toBeUndefined();
    });
});
