// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/webview/App.svelte';
import type { DomainProcessBindingRow, DomainProcessBindingRules, InitialState } from '../../src/webview/types';

const postMessage = vi.hoisted(() => vi.fn());
vi.mock('../../src/webview/vscodeApi', () => ({ postMessage }));

function row(overrides: Partial<DomainProcessBindingRow> = {}): DomainProcessBindingRow {
    return {
        developerName: 'Account_Before_Insert_Test',
        source: 'local',
        label: 'Test',
        sobject: 'Account',
        type: 'Action',
        classToInject: 'MyActionClass',
        processContext: 'TriggerExecution',
        triggerOperation: 'Before_Insert',
        order: 10,
        isActive: true,
        executeAsynchronous: false,
        ...overrides,
    } as DomainProcessBindingRow;
}

afterEach(() => {
    cleanup();
    postMessage.mockClear();
});

describe('App — loading/error/empty', () => {
    it('shows the loading message', () => {
        render(App, { props: { initial: { kind: 'loading' } as InitialState } });
        expect(screen.getByText('Scanning workspace for AT4DX bindings…')).toBeTruthy();
    });

    it('shows the error message', () => {
        render(App, { props: { initial: { kind: 'error', message: 'Boom' } as InitialState } });
        expect(screen.getByText('Boom')).toBeTruthy();
    });

    it('shows the empty message', () => {
        render(App, { props: { initial: { kind: 'empty' } as InitialState } });
        expect(screen.getByText('No AT4DX Trigger Action Framework bindings found.')).toBeTruthy();
    });
});

describe('App — data', () => {
    const initial: InitialState = {
        kind: 'data',
        rows: [row({ developerName: 'A', triggerOperation: 'Before_Insert' }), row({ developerName: 'B', triggerOperation: 'After_Insert' })],
        issues: [],
        rules: {} as DomainProcessBindingRules,
        isLocalScan: true,
    };

    it('groups rows into Before/After Save sections for the default SObject/family', () => {
        render(App, { props: { initial } });

        expect(screen.getByText('Record Before Save')).toBeTruthy();
        expect(screen.getByText('Record After Save')).toBeTruthy();
        expect(screen.getByText('A')).toBeTruthy();
        expect(screen.getByText('B')).toBeTruthy();
        expect(screen.getByText('✓ No problems found')).toBeTruthy();
    });

    it('shows the problem summary instead of "no problems" when issues exist', () => {
        render(App, {
            props: {
                initial: {
                    ...initial,
                    issues: [{ rule: 'order-collision', severity: 'error', scope: 'record', sobject: 'Account', source: 'local', message: 'Collides.', developerName: 'A' }],
                } as InitialState,
            },
        });

        expect(screen.getByText(/1 error\(s\)/)).toBeTruthy();
    });

    it('opens the create form prefilled from the current SObject/Trigger Event selection', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));

        expect(screen.getByText('New Binding')).toBeTruthy();
        const sobjectInput = document.getElementById('fSobject') as HTMLInputElement;
        expect(sobjectInput.value).toBe('Account');
    });

    it('opens the edit form prefilled from the clicked row when its pencil icon is used', async () => {
        render(App, { props: { initial } });

        const editIcons = screen.getAllByTitle('Edit this binding');
        await fireEvent.click(editIcons[0]);

        expect(screen.getByText('Edit Binding')).toBeTruthy();
        const developerNameInput = document.getElementById('fDeveloperName') as HTMLInputElement;
        expect(developerNameInput.value).toBe('A');
    });
});
