// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/webview/App.svelte';
import type { ApplicationFactoryRules, At4dxBindingRow, DomainProcessBindingRow, DomainProcessBindingRules, InitialState } from '../../src/webview/types';

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

function afRow(overrides: Partial<At4dxBindingRow> = {}): At4dxBindingRow {
    return {
        bindingType: 'Service',
        developerName: 'PricingServiceBinding',
        label: 'Test',
        key: 'IPricingService',
        to: 'PricingServiceImpl',
        source: 'local',
        effective: true,
        ...overrides,
    } as At4dxBindingRow;
}

/** Every `InitialState` field a test doesn't care about defaults to "not scanned yet" — matching how the host actually starts a fresh panel. */
function state(overrides: Partial<InitialState> = {}): InitialState {
    return {
        active: 'domainProcess',
        domainProcess: { kind: 'loading' },
        applicationFactory: { kind: 'loading' },
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
    postMessage.mockClear();
});

describe('App — explorer tab strip', () => {
    it('renders all three explorers, with only Platform Events inert', () => {
        render(App, { props: { initial: state() } });

        expect(screen.getByText('Domain Process Bindings')).toBeTruthy();
        expect(screen.getByText('Application Factory')).toBeTruthy();
        expect(screen.getByText('Platform Events')).toBeTruthy();
        expect(screen.getAllByText('Coming soon')).toHaveLength(1);
    });

    it('shows the tab strip even while loading, in error, or empty — not just in the data view', () => {
        render(App, { props: { initial: state({ domainProcess: { kind: 'error', message: 'Boom' } }) } });

        expect(screen.getByText('Domain Process Bindings')).toBeTruthy();
    });

    it('does not show a binding-count badge before there is data to count', () => {
        render(App, { props: { initial: state() } });

        expect(document.querySelector('.explorer-tab-badge')).toBeNull();
    });

    it('posts selectExplorer when the Application Factory tab is clicked', async () => {
        render(App, { props: { initial: state() } });

        await fireEvent.click(screen.getByText('Application Factory'));

        expect(postMessage).toHaveBeenCalledWith({ command: 'selectExplorer', explorer: 'applicationFactory' });
    });

    it('does not post selectExplorer when clicking the already-active tab', async () => {
        render(App, { props: { initial: state() } });

        await fireEvent.click(screen.getByText('Domain Process Bindings'));

        expect(postMessage).not.toHaveBeenCalled();
    });
});

describe('App — Domain Process loading/error/empty', () => {
    it('shows the loading message', () => {
        render(App, { props: { initial: state() } });
        expect(screen.getByText('Scanning workspace for AT4DX bindings…')).toBeTruthy();
    });

    it('shows the error message', () => {
        render(App, { props: { initial: state({ domainProcess: { kind: 'error', message: 'Boom' } }) } });
        expect(screen.getByText('Boom')).toBeTruthy();
    });

    it('shows the empty message', () => {
        render(App, { props: { initial: state({ domainProcess: { kind: 'empty' } }) } });
        expect(screen.getByText('No AT4DX Trigger Action Framework bindings found.')).toBeTruthy();
    });
});

describe('App — Domain Process data', () => {
    const dpRows = [
        row({ developerName: 'A', classToInject: 'AClass', triggerOperation: 'Before_Insert' }),
        row({ developerName: 'B', classToInject: 'BClass', triggerOperation: 'After_Insert' }),
    ];
    const initial: InitialState = state({
        domainProcess: { kind: 'data', rows: dpRows, issues: [], rules: {} as DomainProcessBindingRules },
        isLocalScan: true,
        sourceLabel: 'force-app/main/default',
    });

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
                initial: state({
                    domainProcess: {
                        kind: 'data',
                        rows: dpRows,
                        issues: [{ rule: 'order-collision', severity: 'error', scope: 'record', sobject: 'Account', source: 'local', message: 'Collides.', developerName: 'A' }],
                        rules: {} as DomainProcessBindingRules,
                    },
                    isLocalScan: true,
                    sourceLabel: 'force-app/main/default',
                }),
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
                initial: state({
                    domainProcess: {
                        kind: 'data',
                        rows: [row({ developerName: 'C', sobject: 'Contact', classToInject: 'CClass', triggerOperation: 'Before_Insert' })],
                        issues: [],
                        rules: {} as DomainProcessBindingRules,
                    },
                    isLocalScan: true,
                    sourceLabel: 'force-app/main/default',
                }),
            },
        });

        expect(document.querySelector('.header')?.textContent?.replace(/\s+/g, ' ')).toContain('When a Contact record is Created');
    });

    it('shows the binding count as a badge on the Domain Process Bindings tab, and the source label', () => {
        render(App, { props: { initial } });

        expect(document.querySelector('.explorer-tab-badge')?.textContent).toBe('2');
        expect(screen.getByText('force-app/main/default')).toBeTruthy();
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
    const initial: InitialState = state({
        domainProcess: {
            kind: 'data',
            rows: [row({ developerName: 'A', triggerOperation: 'Before_Insert' })],
            issues: [],
            rules: {} as DomainProcessBindingRules,
        },
        isLocalScan: true,
        sourceLabel: 'force-app/main/default',
    });

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
        render(App, { props: { initial: state() } });

        expect(screen.getByRole('button', { name: '+ New Binding' })).toHaveProperty('disabled', true);
    });
});

describe('App — Application Factory explorer', () => {
    it('shows the loading message', () => {
        render(App, { props: { initial: state({ active: 'applicationFactory' }) } });
        expect(screen.getByText('Scanning workspace for Application Factory bindings…')).toBeTruthy();
    });

    it('shows the error message', () => {
        render(App, { props: { initial: state({ active: 'applicationFactory', applicationFactory: { kind: 'error', message: 'Boom' } }) } });
        expect(screen.getByText('Boom')).toBeTruthy();
    });

    it('shows the empty message', () => {
        render(App, { props: { initial: state({ active: 'applicationFactory', applicationFactory: { kind: 'empty' } }) } });
        expect(screen.getByText('No AT4DX Application Factory bindings found.')).toBeTruthy();
    });

    it('renders a section per binding type present, with the resolved implementation, and no Toolbar', () => {
        render(App, {
            props: {
                initial: state({
                    active: 'applicationFactory',
                    applicationFactory: {
                        kind: 'data',
                        rows: [afRow(), afRow({ bindingType: 'Selector', developerName: 'AccountsSelectorBinding', key: 'Account', to: 'AccountsSelector', priority: 10 })],
                        issues: [],
                        rules: {} as ApplicationFactoryRules,
                    },
                }),
            },
        });

        expect(screen.getByText('Service')).toBeTruthy();
        expect(screen.getByText('Selector')).toBeTruthy();
        expect(screen.getByText('PricingServiceImpl')).toBeTruthy();
        expect(screen.getByText('AccountsSelector')).toBeTruthy();
        expect(document.querySelector('.toolbar')).toBeNull();
    });

    it('shows the binding count as a badge on the Application Factory tab', () => {
        render(App, {
            props: {
                initial: state({
                    applicationFactory: { kind: 'data', rows: [afRow(), afRow({ developerName: 'B' })], issues: [], rules: {} as ApplicationFactoryRules },
                }),
            },
        });

        const afTab = screen.getByText('Application Factory').closest('button');
        expect(afTab?.querySelector('.explorer-tab-badge')?.textContent).toBe('2');
    });

    it('renders the tie banner once for two Service rows tied on priority, with RESOLVES TODAY / MAY WIN INSTEAD chips', () => {
        render(App, {
            props: {
                initial: state({
                    active: 'applicationFactory',
                    applicationFactory: {
                        kind: 'data',
                        rows: [
                            afRow({ developerName: 'A', priority: 10, effective: false }),
                            afRow({ developerName: 'B', priority: 10, effective: true }),
                        ],
                        issues: [],
                        rules: {} as ApplicationFactoryRules,
                    },
                }),
            },
        });

        expect(document.querySelectorAll('.af-tie-banner')).toHaveLength(1);
        expect(screen.getByText('Resolves today')).toBeTruthy();
        expect(screen.getByText('May win instead')).toBeTruthy();
    });
});
