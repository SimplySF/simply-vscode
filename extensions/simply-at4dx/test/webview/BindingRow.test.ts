// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BindingRow from '../../src/webview/BindingRow.svelte';
import type { DomainProcessBindingRow, DomainProcessBindingRules } from '../../src/webview/types';

const postMessage = vi.hoisted(() => vi.fn());
vi.mock('../../src/webview/vscodeApi', () => ({ postMessage }));

const rules = {} as unknown as DomainProcessBindingRules;

function row(overrides: Partial<DomainProcessBindingRow> = {}): DomainProcessBindingRow {
    return {
        developerName: 'Account_Before_Insert_Test',
        source: 'local',
        label: 'Test',
        sobject: 'Account',
        type: 'Action',
        classToInject: 'MyActionClass',
        order: 10,
        isActive: true,
        executeAsynchronous: false,
        preventRecursive: false,
        logicalInverse: false,
        ...overrides,
    } as DomainProcessBindingRow;
}

afterEach(() => {
    cleanup();
    postMessage.mockClear();
});

describe('BindingRow', () => {
    it('posts openClass on a row click', async () => {
        render(BindingRow, { props: { row: row(), badges: [], rules, onEdit: vi.fn() } });

        await fireEvent.click(screen.getByText('Account_Before_Insert_Test'));

        expect(postMessage).toHaveBeenCalledWith({ command: 'openClass', classToInject: 'MyActionClass' });
    });

    it("calls onEdit without also firing the row's openClass click (stopPropagation)", async () => {
        const onEdit = vi.fn();
        render(BindingRow, { props: { row: row(), badges: [], rules, onEdit } });

        await fireEvent.click(screen.getByTitle('Edit this binding'));

        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('renders an issue badge for a matching (developerName, source)', () => {
        const theRow = row();
        render(BindingRow, {
            props: {
                row: theRow,
                badges: [{ index: 0, issue: { rule: 'order-collision', severity: 'error', message: 'Collides.', developerName: theRow.developerName, source: theRow.source } }],
                rules: { 'order-collision': { title: 'Order collision', summary: '' } } as unknown as DomainProcessBindingRules,
                onEdit: vi.fn(),
            },
        });

        expect(screen.getByText(/Order collision/)).toBeTruthy();
    });

    it('shows both recursion/logical-inverse indicators dimmed when both flags are off', () => {
        render(BindingRow, { props: { row: row({ preventRecursive: false, logicalInverse: false }), badges: [], rules, onEdit: vi.fn() } });

        const recursion = screen.getByTitle('Recursion allowed');
        const inverse = screen.getByTitle('Logical inverse disabled');
        expect(recursion.classList.contains('flag-off')).toBe(true);
        expect(inverse.classList.contains('flag-off')).toBe(true);
    });

    it('shows both indicators at full opacity when both flags are on', () => {
        render(BindingRow, { props: { row: row({ preventRecursive: true, logicalInverse: true }), badges: [], rules, onEdit: vi.fn() } });

        const recursion = screen.getByTitle('Recursion prevented');
        const inverse = screen.getByTitle('Logical inverse enabled');
        expect(recursion.classList.contains('flag-off')).toBe(false);
        expect(inverse.classList.contains('flag-off')).toBe(false);
    });

    it('renders each flag independently (mixed on/off)', () => {
        render(BindingRow, { props: { row: row({ preventRecursive: true, logicalInverse: false }), badges: [], rules, onEdit: vi.fn() } });

        expect(screen.getByTitle('Recursion prevented').classList.contains('flag-off')).toBe(false);
        expect(screen.getByTitle('Logical inverse disabled').classList.contains('flag-off')).toBe(true);
    });
});
