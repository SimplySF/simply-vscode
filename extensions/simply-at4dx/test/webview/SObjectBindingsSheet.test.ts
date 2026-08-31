// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SObjectBindingsSheet from '../../src/webview/SObjectBindingsSheet.svelte';
import type { At4dxBindingRow } from '../../src/webview/types';

const postMessage = vi.hoisted(() => vi.fn());
vi.mock('../../src/webview/vscodeApi', () => ({ postMessage }));

function uowRow(developerName: string, sobject: string, sequence: number | undefined): At4dxBindingRow {
    return { bindingType: 'UnitOfWork', developerName, label: developerName, key: sobject, source: 'local', effective: true, sequence } as At4dxBindingRow;
}

afterEach(() => {
    cleanup();
    postMessage.mockClear();
});

describe('SObjectBindingsSheet — drag-and-drop reordering (Stage 3)', () => {
    const rows = [uowRow('AccountUOW', 'Account', 10), uowRow('FishUOW', 'Fish__c', 20), uowRow('ContactUOW', 'Contact', 30)];

    it('shows Move Up/Down buttons only for cards with a real Unit of Work binding, disabled at the boundaries', () => {
        render(SObjectBindingsSheet, {
            props: { rows: [...rows, { bindingType: 'Selector', developerName: 'S', label: 'S', key: 'Widget__c', to: 'WidgetSelector', source: 'local', effective: true } as At4dxBindingRow], domainProcessRows: undefined, canWrite: true, lastBatchResult: undefined, onEdit: vi.fn(), onAdd: vi.fn() },
        });

        // Widget__c has no Unit of Work binding — no reorder controls at all.
        expect(screen.queryByLabelText('Move Widget__c earlier in the commit order')).toBeNull();

        const accountUp = screen.getByLabelText('Move Account earlier in the commit order') as HTMLButtonElement;
        const accountDown = screen.getByLabelText('Move Account later in the commit order') as HTMLButtonElement;
        expect(accountUp.disabled).toBe(true); // first position
        expect(accountDown.disabled).toBe(false);

        const contactDown = screen.getByLabelText('Move Contact later in the commit order') as HTMLButtonElement;
        expect(contactDown.disabled).toBe(true); // last position
    });

    it('stages a pending change and shows the Save bar when Move Down is clicked, with no pending change beforehand', async () => {
        render(SObjectBindingsSheet, { props: { rows, domainProcessRows: undefined, canWrite: true, lastBatchResult: undefined, onEdit: vi.fn(), onAdd: vi.fn() } });

        expect(screen.queryByText(/pending change/)).toBeNull();

        await fireEvent.click(screen.getByLabelText('Move Account later in the commit order'));

        expect(screen.getByText(/1 pending change/)).toBeTruthy();
        // Only the moved card (Account) gets a new sequence — Fish__c ends up ahead of it in position but
        // its own sequence value never changed, so it isn't itself a pending write. See dragReorder.ts.
        expect(document.querySelector('.pcb-summary')?.textContent).toContain('Account commits 2nd, was 1st');
    });

    it('Revert clears every staged move', async () => {
        render(SObjectBindingsSheet, { props: { rows, domainProcessRows: undefined, canWrite: true, lastBatchResult: undefined, onEdit: vi.fn(), onAdd: vi.fn() } });

        await fireEvent.click(screen.getByLabelText('Move Account later in the commit order'));
        expect(screen.getByText(/1 pending change/)).toBeTruthy();

        await fireEvent.click(screen.getByText('Revert'));
        expect(screen.queryByText(/pending change/)).toBeNull();
    });

    it('Save posts submitSequenceBatch with the moved card\'s new sequence, keyed by developerName and sobject', async () => {
        render(SObjectBindingsSheet, { props: { rows, domainProcessRows: undefined, canWrite: true, lastBatchResult: undefined, onEdit: vi.fn(), onAdd: vi.fn() } });

        await fireEvent.click(screen.getByLabelText('Move Account later in the commit order'));
        await fireEvent.click(screen.getByText('Save commit order'));

        expect(postMessage).toHaveBeenCalledWith({
            command: 'submitSequenceBatch',
            updates: [{ developerName: 'AccountUOW', sobject: 'Account', sequence: 25 }],
        });
    });

    it('a round trip (down then up) reports no pending change', async () => {
        render(SObjectBindingsSheet, { props: { rows, domainProcessRows: undefined, canWrite: true, lastBatchResult: undefined, onEdit: vi.fn(), onAdd: vi.fn() } });

        await fireEvent.click(screen.getByLabelText('Move Account later in the commit order'));
        await fireEvent.click(screen.getByLabelText('Move Account earlier in the commit order'));

        expect(screen.queryByText(/pending change/)).toBeNull();
    });

    it('renders no reorder controls at all when canWrite is false', () => {
        render(SObjectBindingsSheet, { props: { rows, domainProcessRows: undefined, canWrite: false, lastBatchResult: undefined, onEdit: vi.fn(), onAdd: vi.fn() } });

        expect(screen.queryByLabelText('Move Account earlier in the commit order')).toBeNull();
        expect(document.querySelector('.pcb-bar')).toBeNull();
    });

    it('shows a sequence-collision banner between two cards sharing a sequence, without blocking the sheet', () => {
        render(SObjectBindingsSheet, {
            props: { rows: [uowRow('AccountUOW', 'Account', 10), uowRow('FishUOW', 'Fish__c', 10)], domainProcessRows: undefined, canWrite: true, lastBatchResult: undefined, onEdit: vi.fn(), onAdd: vi.fn() },
        });

        expect(screen.getByText(/sequence-collision/)).toBeTruthy();
        expect(screen.getByText('Account')).toBeTruthy();
        expect(screen.getByText('Fish__c')).toBeTruthy();
    });

    it('reports a successful batch result banner once', () => {
        render(SObjectBindingsSheet, {
            props: { rows, domainProcessRows: undefined, canWrite: true, lastBatchResult: { savedCount: 2, totalCount: 2 }, onEdit: vi.fn(), onAdd: vi.fn() },
        });

        expect(document.querySelector('.pcb-batch-result.ok')?.textContent).toContain('Saved 2 of 2');
    });

    it('recovers from a writeError while saving — stops "Saving…" and shows the message', async () => {
        render(SObjectBindingsSheet, { props: { rows, domainProcessRows: undefined, canWrite: true, lastBatchResult: undefined, onEdit: vi.fn(), onAdd: vi.fn() } });

        await fireEvent.click(screen.getByLabelText('Move Account later in the commit order'));
        await fireEvent.click(screen.getByText('Save commit order'));
        expect(screen.getByText('Saving…')).toBeTruthy();

        window.dispatchEvent(new MessageEvent('message', { data: { command: 'writeError', message: 'Could not reach the org.' } }));
        await Promise.resolve();

        expect(screen.getByText('Could not reach the org.')).toBeTruthy();
        expect(screen.getByText('Save commit order')).toBeTruthy();
        expect((screen.getByText('Save commit order') as HTMLButtonElement).disabled).toBe(false);
    });

    it('reports a partial-failure batch result banner, naming the failed SObject and its message', () => {
        render(SObjectBindingsSheet, {
            props: {
                rows,
                domainProcessRows: undefined,
                canWrite: true,
                lastBatchResult: { savedCount: 1, totalCount: 3, failed: { sobject: 'Fish__c', message: 'Deploy failed.' } },
                onEdit: vi.fn(),
                onAdd: vi.fn(),
            },
        });

        const banner = document.querySelector('.pcb-batch-result.failed');
        expect(banner?.textContent).toContain('Saved 1 of 3');
        expect(banner?.textContent).toContain('Fish__c');
        expect(banner?.textContent).toContain('Deploy failed.');
        expect(banner?.textContent).toContain("weren't attempted");
    });
});
