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
        rows: [
            row({ developerName: 'A', classToInject: 'AClass', triggerOperation: 'Before_Insert' }),
            row({ developerName: 'B', classToInject: 'BClass', triggerOperation: 'After_Insert' }),
        ],
        issues: [],
        rules: {} as DomainProcessBindingRules,
        isLocalScan: true,
    };

    it('groups rows into Before/After Save sections for the default SObject/family', () => {
        render(App, { props: { initial } });

        expect(screen.getByText('Record Before Save')).toBeTruthy();
        expect(screen.getByText('Record After Save')).toBeTruthy();
        expect(screen.getByText('AClass')).toBeTruthy();
        expect(screen.getByText('BClass')).toBeTruthy();
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

    it('renders the header as a binding-count context strip with no crown icon', () => {
        render(App, { props: { initial } });

        const headerText = document.querySelector('.header')?.textContent?.replace(/\s+/g, ' ');
        expect(headerText).toContain('When an Account record is Created');
        expect(headerText).toContain('2 bindings are evaluated in order');
        expect(document.querySelector('.header')?.querySelector('svg')).toBeNull();
    });

    it('uses "a" for a consonant-initial SObject in the header sentence', () => {
        render(App, {
            props: {
                initial: {
                    kind: 'data',
                    rows: [row({ developerName: 'C', sobject: 'Contact', classToInject: 'CClass', triggerOperation: 'Before_Insert' })],
                    issues: [],
                    rules: {} as DomainProcessBindingRules,
                    isLocalScan: true,
                } as InitialState,
            },
        });

        expect(document.querySelector('.header')?.textContent?.replace(/\s+/g, ' ')).toContain('When a Contact record is Created');
    });

    it('opens the create form prefilled from the current SObject/Trigger Event selection', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));

        expect(screen.getByText('New binding')).toBeTruthy();
        const sobjectInput = document.getElementById('fSobject') as HTMLInputElement;
        expect(sobjectInput.value).toBe('Account');
    });

    it('opens the edit form prefilled from the clicked row when its pencil icon is used', async () => {
        render(App, { props: { initial } });

        const editIcons = screen.getAllByTitle('Edit this binding');
        await fireEvent.click(editIcons[0]);

        expect(screen.getByText('Editing')).toBeTruthy();
        const developerNameInput = document.getElementById('fDeveloperName') as HTMLInputElement;
        expect(developerNameInput.value).toBe('A');
        expect(developerNameInput.disabled).toBe(true);
    });
});

describe('App — the New Binding toolbar and the create/edit form are mutually exclusive', () => {
    const initial: InitialState = {
        kind: 'data',
        rows: [row({ developerName: 'A', triggerOperation: 'Before_Insert' })],
        issues: [],
        rules: {} as DomainProcessBindingRules,
        isLocalScan: true,
    };

    it('shows + New Binding while browsing the list', () => {
        render(App, { props: { initial } });

        expect(screen.getByText('+ New Binding')).toBeTruthy();
    });

    it('hides + New Binding once the create form is open', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));

        expect(screen.queryByText('+ New Binding')).toBeNull();
    });

    it('hides + New Binding once the edit form is open', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[0]);

        expect(screen.queryByText('+ New Binding')).toBeNull();
    });

    it('returns to the list — with + New Binding restored — after cancelling the create form', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));
        await fireEvent.click(screen.getByText('Cancel'));

        expect(screen.getByText('+ New Binding')).toBeTruthy();
    });

    it('shows a disabled placeholder + New Binding while loading', () => {
        render(App, { props: { initial: { kind: 'loading' } as InitialState } });

        expect(screen.getByRole('button', { name: '+ New Binding' })).toHaveProperty('disabled', true);
    });
});
