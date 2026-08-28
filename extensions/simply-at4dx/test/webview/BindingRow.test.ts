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
    it('renders order, type, class, recursion, logical inverse, and status from row fields', () => {
        render(BindingRow, {
            props: { row: row({ order: 10.1, type: 'Criteria', preventRecursive: true, logicalInverse: true, isActive: true }), badges: [], rules, onEdit: vi.fn() },
        });

        expect(screen.getByText('10.1')).toBeTruthy();
        expect(screen.getByText('Criteria')).toBeTruthy();
        expect(screen.getByText('MyActionClass')).toBeTruthy();
        expect(screen.getByText('Enabled')).toBeTruthy();
        expect(screen.getByText('Yes')).toBeTruthy();
        expect(screen.getByText('Active')).toBeTruthy();
    });

    it('does not render the developer name', () => {
        render(BindingRow, { props: { row: row(), badges: [], rules, onEdit: vi.fn() } });

        expect(screen.queryByText('Account_Before_Insert_Test')).toBeNull();
    });

    it('shows em-dashes for disabled async/recursion/logical-inverse flags and "Inactive" for an inactive row', () => {
        render(BindingRow, {
            props: { row: row({ executeAsynchronous: false, preventRecursive: false, logicalInverse: false, isActive: false }), badges: [], rules, onEdit: vi.fn() },
        });

        expect(screen.getAllByText('—')).toHaveLength(3);
        expect(screen.getByText('Inactive')).toBeTruthy();
    });

    it('shows the async column as "Yes" (with the clock icon) when the binding executes asynchronously, and hides it from the type pill', () => {
        render(BindingRow, { props: { row: row({ executeAsynchronous: true }), badges: [], rules, onEdit: vi.fn() } });

        expect(screen.getByText('Yes')).toBeTruthy();
        expect(document.querySelector('.row-async-icon svg')).toBeTruthy();
        expect(screen.queryByText('Action · async')).toBeNull();
        expect(screen.getByText('Action')).toBeTruthy();
    });

    it('dims the whole row when inactive', () => {
        render(BindingRow, { props: { row: row({ isActive: false }), badges: [], rules, onEdit: vi.fn() } });

        expect(document.querySelector('.row')?.classList.contains('inactive')).toBe(true);
    });

    it('posts openClass on a row click', async () => {
        render(BindingRow, { props: { row: row(), badges: [], rules, onEdit: vi.fn() } });

        await fireEvent.click(screen.getByText('MyActionClass'));

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

    it('renders the issue badge in its own cell, a sibling of the status indicator', () => {
        const theRow = row();
        render(BindingRow, {
            props: {
                row: theRow,
                badges: [{ index: 0, issue: { rule: 'order-collision', severity: 'error', message: 'Collides.', developerName: theRow.developerName, source: theRow.source } }],
                rules: { 'order-collision': { title: 'Order collision', summary: '' } } as unknown as DomainProcessBindingRules,
                onEdit: vi.fn(),
            },
        });

        expect(document.querySelector('.row-badges .badge')).toBeTruthy();
        expect(document.querySelector('.row-status .badge')).toBeNull();
        expect(document.querySelector('.row-status .status-indicator')).toBeTruthy();
    });

    it('carries the developer name as the row tooltip', () => {
        render(BindingRow, { props: { row: row({ developerName: 'Account_Before_Insert_Test' }), badges: [], rules, onEdit: vi.fn() } });

        expect(document.querySelector('.row')?.getAttribute('title')).toBe('Account_Before_Insert_Test');
    });

    it('gives the recursion and logical-inverse cells their own tooltips', () => {
        render(BindingRow, { props: { row: row({ preventRecursive: true, logicalInverse: false }), badges: [], rules, onEdit: vi.fn() } });

        expect(screen.getByTitle('Recursion prevented')).toBeTruthy();
        expect(screen.getByTitle('Logical inverse disabled')).toBeTruthy();
    });
});
