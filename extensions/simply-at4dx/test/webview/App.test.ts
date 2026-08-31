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

    it('only the active tab carries explorer-tab-active — the inactive live tab is visually distinct, not just underlined', () => {
        render(App, { props: { initial: state() } });

        const domainProcessTab = screen.getByText('Domain Process Bindings').closest('button');
        const applicationFactoryTab = screen.getByText('Application Factory').closest('button');
        expect(domainProcessTab?.classList.contains('explorer-tab-active')).toBe(true);
        expect(applicationFactoryTab?.classList.contains('explorer-tab-active')).toBe(false);
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

    it('renders a section per binding type present, with the resolved implementation, and no SObject/Trigger Event dropdowns', () => {
        render(App, {
            props: {
                initial: state({
                    active: 'applicationFactory',
                    applicationFactory: {
                        kind: 'data',
                        rows: [afRow(), afRow({ bindingType: 'Selector', developerName: 'AccountsSelectorBinding', key: 'Account', to: 'AccountsSelector', priority: 10 })],
                        issues: [],
                        rules: {} as ApplicationFactoryRules,
                        standardObjects: [],
                    },
                }),
            },
        });

        expect(screen.getByText('Service')).toBeTruthy();
        expect(screen.getByText('Selector')).toBeTruthy();
        expect(screen.getByText('PricingServiceImpl')).toBeTruthy();
        expect(screen.getByText('AccountsSelector')).toBeTruthy();
        expect(screen.getByText('+ New Binding')).toBeTruthy();
        expect(document.querySelector('.toolbar select')).toBeNull();
    });

    it('shows the binding count as a badge on the Application Factory tab', () => {
        render(App, {
            props: {
                initial: state({
                    applicationFactory: { kind: 'data', rows: [afRow(), afRow({ developerName: 'B' })], issues: [], rules: {} as ApplicationFactoryRules, standardObjects: [] },
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
                        standardObjects: [],
                    },
                }),
            },
        });

        expect(document.querySelectorAll('.af-tie-banner')).toHaveLength(1);
        expect(screen.getByText('Resolves today')).toBeTruthy();
        expect(screen.getByText('May win instead')).toBeTruthy();
        const bannerText = document.querySelector('.af-tie-banner-text')?.textContent?.replace(/\s+/g, ' ');
        expect(bannerText).toContain('IPricingService');
        expect(bannerText).toContain('both at priority');
        expect(bannerText).toContain('overwrites one map entry with the other');
        expect(bannerText).toContain('Give one a higher priority to make it deterministic');
    });

    it('a shadowed row with a blank priority shows a SHADOWED badge and "blank sorts lowest", not a generic Shadowed dot', () => {
        render(App, {
            props: {
                initial: state({
                    active: 'applicationFactory',
                    applicationFactory: {
                        kind: 'data',
                        rows: [
                            afRow({ bindingType: 'Selector', developerName: 'A', key: 'Account', to: 'PremiumAccountsSelector', priority: 20, effective: true }),
                            afRow({ bindingType: 'Selector', developerName: 'B', key: 'Account', to: 'AccountsSelector', priority: undefined, effective: false }),
                        ],
                        issues: [],
                        rules: {} as ApplicationFactoryRules,
                        standardObjects: [],
                    },
                }),
            },
        });

        expect(screen.getByText('WINS')).toBeTruthy();
        expect(screen.getByText('SHADOWED')).toBeTruthy();
        expect(screen.getByText('blank sorts lowest')).toBeTruthy();
        expect(screen.queryByText('Shadowed')).toBeNull();
    });

    it('renders the Unit of Work toolbar, a collision banner for a tied pair, and amber Sequence/Commits cells', () => {
        render(App, {
            props: {
                initial: state({
                    active: 'applicationFactory',
                    applicationFactory: {
                        kind: 'data',
                        rows: [
                            afRow({ bindingType: 'UnitOfWork', developerName: 'Account_UOW', key: 'Account', to: undefined, sequence: 10, effective: true }),
                            afRow({ bindingType: 'UnitOfWork', developerName: 'Fish_UOW', key: 'Fish__c', to: undefined, sequence: 20, effective: true }),
                            afRow({ bindingType: 'UnitOfWork', developerName: 'Widget_UOW', key: 'Widget__c', to: undefined, sequence: 20, effective: true }),
                        ],
                        issues: [],
                        rules: {} as ApplicationFactoryRules,
                        standardObjects: [],
                    },
                }),
            },
        });

        const toolbarText = document.querySelector('.uow-toolbar-text')?.textContent?.replace(/\s+/g, ' ');
        expect(toolbarText).toContain('Drag to reorder — each move is one');
        expect(toolbarText).toContain('binding update --sequence');
        expect(screen.getByText('⚠ 1 warning')).toBeTruthy();
        expect(document.querySelectorAll('.af-tie-banner')).toHaveLength(1);
        const bannerText = document.querySelector('.af-tie-banner-text')?.textContent?.replace(/\s+/g, ' ');
        expect(bannerText).toContain('sequence-collision');
        expect(bannerText).toContain('BindingSequence__c 20');
        expect(bannerText).toContain('Both SObjects are registered');
        expect(document.querySelectorAll('.af-priority-tied')).toHaveLength(2);
        expect(document.querySelectorAll('.uow-commits-tied')).toHaveLength(2);
        // Both tied rows share the ordinal range, not a single position.
        expect(screen.getAllByText('2nd or 3rd')).toHaveLength(2);
    });

    it('two Unit of Work rows with no sequence at all show no banner and read unordered', () => {
        render(App, {
            props: {
                initial: state({
                    active: 'applicationFactory',
                    applicationFactory: {
                        kind: 'data',
                        rows: [
                            afRow({ bindingType: 'UnitOfWork', developerName: 'A_UOW', key: 'Account', to: undefined, sequence: undefined, effective: true }),
                            afRow({ bindingType: 'UnitOfWork', developerName: 'B_UOW', key: 'Contact', to: undefined, sequence: undefined, effective: true }),
                        ],
                        issues: [],
                        rules: {} as ApplicationFactoryRules,
                        standardObjects: [],
                    },
                }),
            },
        });

        expect(document.querySelectorAll('.af-tie-banner')).toHaveLength(0);
        expect(screen.queryByText(/warning/)).toBeNull();
        expect(screen.getAllByText('unordered — no sequence set')).toHaveLength(2);
    });
});

describe('App — Application Factory create/edit form (stage 2)', () => {
    const initial: InitialState = state({
        active: 'applicationFactory',
        applicationFactory: {
            kind: 'data',
            rows: [afRow({ bindingType: 'Selector', developerName: 'AccountsSelectorBinding', key: 'Account', to: 'AccountsSelector', priority: 10 })],
            issues: [],
            rules: {} as ApplicationFactoryRules,
            standardObjects: ['Account'],
        },
    });

    it('opens the create form, hiding + New Binding, and defaults to the Service segment', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));

        expect(screen.getByText('New Application Factory binding')).toBeTruthy();
        expect(screen.queryByText('+ New Binding')).toBeNull();
        expect(document.getElementById('fBindingInterface')).toBeTruthy();
    });

    it('opens the edit form prefilled from the clicked row, with the segmented control disabled', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[0]);

        expect(screen.getByText('Editing')).toBeTruthy();
        const developerNameInput = document.getElementById('fDeveloperName') as HTMLInputElement;
        expect(developerNameInput.value).toBe('AccountsSelectorBinding');
        expect(developerNameInput.disabled).toBe(true);
        const sobjectInput = document.getElementById('fSobject') as HTMLInputElement;
        expect(sobjectInput.value).toBe('Account');
        for (const segment of document.querySelectorAll<HTMLButtonElement>('#fBindingType .segmented-option')) {
            expect(segment.disabled).toBe(true);
        }
    });

    it('posts submitApplicationFactoryBinding with a Selector-shaped payload on save', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));
        await fireEvent.click(screen.getByText('Selector'));
        await fireEvent.input(document.getElementById('fDeveloperName') as HTMLInputElement, { target: { value: 'ContactsSelectorBinding' } });
        await fireEvent.input(document.getElementById('fSobject') as HTMLInputElement, { target: { value: 'Contact' } });
        await fireEvent.input(document.getElementById('fTo') as HTMLInputElement, { target: { value: 'ContactsSelector' } });
        await fireEvent.click(screen.getByText('Create binding'));

        expect(postMessage).toHaveBeenCalledWith({
            command: 'submitApplicationFactoryBinding',
            mode: 'create',
            input: { bindingType: 'Selector', developerName: 'ContactsSelectorBinding', label: '', to: 'ContactsSelector', sobject: 'Contact', sobjectAlternate: false, priority: undefined },
            force: false,
        });
    });

    it('returns to the list — with + New Binding restored — after cancelling the create form', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));
        await fireEvent.click(screen.getByText('Cancel'));

        expect(screen.getByText('+ New Binding')).toBeTruthy();
    });
});

describe('App — Application Factory Unit of Work create/edit (stage 3)', () => {
    const initial: InitialState = state({
        active: 'applicationFactory',
        applicationFactory: {
            kind: 'data',
            rows: [afRow({ bindingType: 'UnitOfWork', developerName: 'AccountUnitOfWork', key: 'Account', to: undefined, sequence: 10, effective: true })],
            issues: [],
            rules: {} as ApplicationFactoryRules,
            standardObjects: ['Account'],
        },
    });

    it('shows no Implementation/Priority field and a Commit Sequence field for the Unit of Work segment', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));
        await fireEvent.click(screen.getByText('Unit of Work'));

        expect(document.getElementById('fSequence')).toBeTruthy();
        expect(document.getElementById('fTo')).toBeNull();
        expect(document.getElementById('fPriority')).toBeNull();
    });

    it('opens the edit form from the Unit of Work section\'s pencil icon, prefilled with sequence and no Implementation field', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByTitle('Edit this binding'));

        expect(screen.getByText('Editing')).toBeTruthy();
        const sobjectInput = document.getElementById('fSobject') as HTMLInputElement;
        expect(sobjectInput.value).toBe('Account');
        const sequenceInput = document.getElementById('fSequence') as HTMLInputElement;
        expect(sequenceInput.value).toBe('10');
        expect(document.getElementById('fTo')).toBeNull();
    });

    it('posts submitApplicationFactoryBinding with a UnitOfWork-shaped payload — no to/priority, includes sequence', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));
        await fireEvent.click(screen.getByText('Unit of Work'));
        await fireEvent.input(document.getElementById('fDeveloperName') as HTMLInputElement, { target: { value: 'ContactUnitOfWork' } });
        await fireEvent.input(document.getElementById('fSobject') as HTMLInputElement, { target: { value: 'Contact' } });
        await fireEvent.input(document.getElementById('fSequence') as HTMLInputElement, { target: { value: '20' } });
        await fireEvent.click(screen.getByText('Create binding'));

        expect(postMessage).toHaveBeenCalledWith({
            command: 'submitApplicationFactoryBinding',
            mode: 'create',
            input: { bindingType: 'UnitOfWork', developerName: 'ContactUnitOfWork', label: '', sobject: 'Contact', sobjectAlternate: false, sequence: 20 },
            force: false,
        });
    });

    it('shows the live commit-position preview against the other existing Unit of Work rows', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));
        await fireEvent.click(screen.getByText('Unit of Work'));
        await fireEvent.input(document.getElementById('fSobject') as HTMLInputElement, { target: { value: 'Contact' } });
        await fireEvent.input(document.getElementById('fSequence') as HTMLInputElement, { target: { value: '20' } });

        const previewText = document.querySelector('.form-preview-text')?.textContent?.replace(/\s+/g, ' ');
        expect(previewText).toContain('joins the shared Unit of Work and commits');
        expect(previewText).toContain('2nd');
        expect(previewText).toContain('of 2');
    });
});
