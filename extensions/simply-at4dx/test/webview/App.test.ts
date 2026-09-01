// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
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
    it('renders all four explorers, with only Platform Events inert', () => {
        render(App, { props: { initial: state() } });

        expect(screen.getByText('Domain Process Bindings')).toBeTruthy();
        expect(screen.getByText('SObject Bindings')).toBeTruthy();
        expect(screen.getByText('Service Bindings')).toBeTruthy();
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

    it('posts selectExplorer (applicationFactory, afTab: sobject) when the SObject Bindings tab is clicked', async () => {
        render(App, { props: { initial: state() } });

        await fireEvent.click(screen.getByText('SObject Bindings'));

        expect(postMessage).toHaveBeenCalledWith({ command: 'selectExplorer', explorer: 'applicationFactory', afTab: 'sobject' });
    });

    it('posts selectExplorer (applicationFactory, afTab: service) when the Service Bindings tab is clicked', async () => {
        render(App, { props: { initial: state() } });

        await fireEvent.click(screen.getByText('Service Bindings'));

        expect(postMessage).toHaveBeenCalledWith({ command: 'selectExplorer', explorer: 'applicationFactory', afTab: 'service' });
    });

    it('does not post selectExplorer when clicking the already-active tab', async () => {
        render(App, { props: { initial: state() } });

        await fireEvent.click(screen.getByText('Domain Process Bindings'));

        expect(postMessage).not.toHaveBeenCalled();
    });

    it('switches between SObject Bindings and Service Bindings without re-posting selectExplorer once applicationFactory is already active', async () => {
        render(App, { props: { initial: state({ active: 'applicationFactory', applicationFactory: { kind: 'empty' } }) } });

        await fireEvent.click(screen.getByText('Service Bindings'));

        expect(postMessage).not.toHaveBeenCalled();
    });

    it('opens on the Service Bindings tab, not SObject Bindings, when initial.applicationFactoryTab is service — regression test for a full re-render (e.g. after a write) losing track of which sub-tab was showing', () => {
        render(App, {
            props: {
                initial: state({
                    active: 'applicationFactory',
                    applicationFactoryTab: 'service',
                    applicationFactory: { kind: 'data', rows: [afRow()], issues: [], rules: {} as ApplicationFactoryRules, standardObjects: [], fieldSetInclusions: [], fieldSetInclusionIssues: [], fieldSetInclusionRules: {} as ApplicationFactoryRules },
                }),
            },
        });

        expect(screen.getByText('PricingServiceImpl')).toBeTruthy();
        const serviceTab = screen.getByText('Service Bindings').closest('button');
        expect(serviceTab?.getAttribute('aria-selected')).toBe('true');
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

        expect(screen.getByText('New domain process binding')).toBeTruthy();
        const sobjectInput = document.getElementById('fSobject') as HTMLInputElement;
        expect(sobjectInput.value).toBe('Account');
    });

    it('opens the edit form prefilled from the clicked row when its pencil icon is used', async () => {
        render(App, { props: { initial } });

        const editIcons = screen.getAllByTitle('Edit this binding');
        await fireEvent.click(editIcons[0]);

        expect(screen.getByText('Edit domain process binding')).toBeTruthy();
        const developerNameInput = document.getElementById('fDeveloperName') as HTMLInputElement;
        expect(developerNameInput.value).toBe('A');
        expect(developerNameInput.disabled).toBe(true);
    });

    it('renders the Domain Process drawer as a narrow panel over the still-visible bindings list', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[0]);

        expect(document.querySelector('.drawer-panel')).toBeTruthy();
        expect(document.querySelector('.drawer-backdrop')).toBeTruthy();
        expect(document.querySelector('#content .row-class')?.textContent).toBe('AClass'); // the list row behind it stays rendered
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

    it('renders a card per SObject on the SObject Bindings tab, with the resolved implementation, and no SObject/Trigger Event dropdowns', () => {
        render(App, {
            props: {
                initial: state({
                    active: 'applicationFactory',
                    applicationFactory: {
                        kind: 'data',
                        rows: [afRow({ bindingType: 'Selector', developerName: 'AccountsSelectorBinding', key: 'Account', to: 'AccountsSelector', priority: 10 })],
                        issues: [],
                        rules: {} as ApplicationFactoryRules,
                        standardObjects: [], fieldSetInclusions: [], fieldSetInclusionIssues: [], fieldSetInclusionRules: {} as ApplicationFactoryRules,
                    },
                }),
            },
        });

        expect(screen.getByText('Account')).toBeTruthy();
        expect(screen.getByText('AccountsSelector')).toBeTruthy();
        expect(screen.getByText('+ New Binding')).toBeTruthy();
        expect(document.querySelector('.toolbar select')).toBeNull();
    });

    it('renders Service bindings on the Service Bindings tab, not the SObject Bindings tab', async () => {
        render(App, {
            props: {
                initial: state({
                    active: 'applicationFactory',
                    applicationFactory: { kind: 'data', rows: [afRow()], issues: [], rules: {} as ApplicationFactoryRules, standardObjects: [], fieldSetInclusions: [], fieldSetInclusionIssues: [], fieldSetInclusionRules: {} as ApplicationFactoryRules },
                }),
            },
        });

        expect(screen.queryByText('PricingServiceImpl')).toBeNull();

        await fireEvent.click(screen.getByText('Service Bindings'));

        expect(screen.getByText('PricingServiceImpl')).toBeTruthy();
    });

    it('shows the binding count as a badge on each of the SObject Bindings and Service Bindings tabs', () => {
        render(App, {
            props: {
                initial: state({
                    applicationFactory: {
                        kind: 'data',
                        rows: [afRow(), afRow({ developerName: 'B' }), afRow({ bindingType: 'Selector', developerName: 'C', key: 'Account', to: 'AccountsSelector' })],
                        issues: [],
                        rules: {} as ApplicationFactoryRules,
                        standardObjects: [], fieldSetInclusions: [], fieldSetInclusionIssues: [], fieldSetInclusionRules: {} as ApplicationFactoryRules,
                    },
                }),
            },
        });

        const sobjectTab = screen.getByText('SObject Bindings').closest('button');
        expect(sobjectTab?.querySelector('.explorer-tab-badge')?.textContent).toBe('1');
        const serviceTab = screen.getByText('Service Bindings').closest('button');
        expect(serviceTab?.querySelector('.explorer-tab-badge')?.textContent).toBe('2');
    });

    it('renders the tie banner once for two Service rows tied on priority, with RESOLVES TODAY / MAY WIN INSTEAD chips', async () => {
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
                        standardObjects: [], fieldSetInclusions: [], fieldSetInclusionIssues: [], fieldSetInclusionRules: {} as ApplicationFactoryRules,
                    },
                }),
            },
        });

        await fireEvent.click(screen.getByText('Service Bindings'));

        expect(document.querySelectorAll('.af-tie-banner')).toHaveLength(1);
        expect(screen.getByText('Resolves today')).toBeTruthy();
        expect(screen.getByText('May win instead')).toBeTruthy();
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
            standardObjects: ['Account'], fieldSetInclusions: [], fieldSetInclusionIssues: [], fieldSetInclusionRules: {} as ApplicationFactoryRules,
        },
    });

    it('opens a type menu (Selector/Domain/Unit of Work, never Service) and opens the create form pre-set to the chosen type', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));

        // The menu itself — canvas 1c — never offers Service, since it keys on an interface, not an
        // SObject, and is created from its own tab instead.
        expect(screen.getByRole('menuitem', { name: /^Selector/ })).toBeTruthy();
        expect(screen.getByRole('menuitem', { name: /^Domain/ })).toBeTruthy();
        expect(screen.getByRole('menuitem', { name: /^Unit of Work/ })).toBeTruthy();
        expect(screen.queryByRole('menuitem', { name: /^Service/ })).toBeNull();

        await fireEvent.click(screen.getByRole('menuitem', { name: /^Domain/ }));

        expect(screen.getByText('New domain binding')).toBeTruthy();
        // The breadcrumb legitimately shows its own "+ New Binding" link (the entry point) once the
        // form is open — it's the toolbar's own button that must disappear, so there's only ever one
        // primary "+ New Binding" action on screen at a time. See docs/design/0016's original rule and
        // docs/design/0017's breadcrumb addition.
        expect(document.querySelector('.toolbar')).toBeNull();
        // No in-drawer control to switch away from the chosen type — see docs/design/0017.
        expect(document.getElementById('fBindingType')).toBeNull();
        expect(document.querySelector('.drawer-panel .af-type-pill')?.textContent?.trim()).toBe('DOMAIN');
    });

    it("Service Bindings tab's + New Binding has no menu — it opens the create form directly, defaulting to Service", async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('Service Bindings'));
        await fireEvent.click(screen.getByText('+ New Binding'));

        expect(screen.getByText('New service binding')).toBeTruthy();
        expect(document.getElementById('fBindingInterface')).toBeTruthy();
    });

    it('opens the edit form prefilled from the clicked row, with no control to switch its type', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[0]);

        expect(screen.getByText('Edit selector binding')).toBeTruthy();
        const developerNameInput = document.getElementById('fDeveloperName') as HTMLInputElement;
        expect(developerNameInput.value).toBe('AccountsSelectorBinding');
        expect(developerNameInput.disabled).toBe(true);
        const sobjectInput = document.getElementById('fSobject') as HTMLInputElement;
        expect(sobjectInput.value).toBe('Account');
        expect(document.getElementById('fBindingType')).toBeNull();
    });

    it('renders the entry-point breadcrumb, a solid type pill, and no CLI preview in edit mode', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[0]);

        const breadcrumb = document.querySelector('.form-breadcrumb-bar');
        expect(breadcrumb?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Account › SELECTOR AccountsSelector');
        const pill = document.querySelector('.form-breadcrumb-bar .af-type-pill');
        expect(pill?.classList.contains('af-type-pill-dashed')).toBe(false);
        expect(document.querySelector('.form-cli-preview')).toBeNull();
    });

    it('shows a dashed pill and a CLI preview footer while creating', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));
        await fireEvent.click(screen.getByText('Selector'));
        await fireEvent.input(document.getElementById('fDeveloperName') as HTMLInputElement, { target: { value: 'ContactsSelectorBinding' } });
        await fireEvent.input(document.getElementById('fSobject') as HTMLInputElement, { target: { value: 'Contact' } });
        await fireEvent.input(document.getElementById('fTo') as HTMLInputElement, { target: { value: 'ContactsSelector' } });

        const pill = document.querySelector('.form-breadcrumb-bar .af-type-pill');
        expect(pill?.classList.contains('af-type-pill-dashed')).toBe(true);
        expect(document.querySelector('.form-cli-preview')?.textContent).toBe(
            'binding create --type selector --developer-name ContactsSelectorBinding --sobject Contact --to ContactsSelector',
        );
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
        await fireEvent.click(screen.getByRole('menuitem', { name: /^Selector/ }));
        await fireEvent.click(screen.getByText('Cancel'));

        expect(screen.getByText('+ New Binding')).toBeTruthy();
    });

    it('closes the type menu without opening the form when clicking outside it', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));
        expect(screen.getByRole('menu')).toBeTruthy();

        await fireEvent.click(document.body);

        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.getByText('+ New Binding')).toBeTruthy();
    });

    it('never renders a control to switch binding type — the type menu chose it, once, before the drawer opened', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));
        await fireEvent.click(screen.getByRole('menuitem', { name: /^Unit of Work/ }));

        expect(document.getElementById('fBindingType')).toBeNull();
        expect(screen.queryByText('Service')).toBeNull();
        expect(screen.queryByText('Domain')).toBeNull();
    });

    it('renders the create drawer as a narrow panel over the still-visible SObject Bindings sheet, not a full-screen replacement', async () => {
        render(App, { props: { initial } });

        // The card behind the drawer (Account, from `initial`'s own Selector row) stays in the DOM —
        // this is the whole point of an overlay drawer rather than swapping out the list. See
        // docs/design/0017's "does not cover the entire screen" fix.
        expect(document.querySelector('.sb-sheet')).toBeTruthy();

        await fireEvent.click(screen.getByText('+ New Binding'));
        await fireEvent.click(screen.getByRole('menuitem', { name: /^Selector/ }));

        expect(document.querySelector('.drawer-panel')).toBeTruthy();
        expect(document.querySelector('.drawer-backdrop')).toBeTruthy();
        expect(document.querySelector('.sb-sheet')).toBeTruthy(); // still there, behind the overlay
    });

    it('closes the drawer when the backdrop is clicked, same as Cancel', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getByText('+ New Binding'));
        await fireEvent.click(screen.getByRole('menuitem', { name: /^Selector/ }));
        expect(document.querySelector('.drawer-panel')).toBeTruthy();

        await fireEvent.click(document.querySelector('.drawer-backdrop') as HTMLElement);

        expect(document.querySelector('.drawer-panel')).toBeNull();
        expect(screen.getByText('+ New Binding')).toBeTruthy();
    });
});

describe('App — field set inclusions (stage 4)', () => {
    function fieldSetInclusion(overrides: Record<string, unknown> = {}) {
        return {
            developerName: 'Account_TierFields',
            label: 'Account Tier Fields',
            sobject: 'Account',
            sobjectField: 'primary',
            fieldsetName: 'AccountTierFields',
            isActive: true,
            source: 'local',
            ...overrides,
        };
    }

    const initial: InitialState = state({
        active: 'applicationFactory',
        applicationFactory: {
            kind: 'data',
            rows: [
                afRow({ bindingType: 'Selector', developerName: 'AccountsSelectorBinding', key: 'Account', to: 'AccountsSelector', priority: 10 }),
                afRow({ bindingType: 'Domain', developerName: 'AccountsDomainBinding', key: 'Account', to: 'Accounts' }),
            ],
            issues: [],
            rules: {} as ApplicationFactoryRules,
            standardObjects: ['Account'],
            fieldSetInclusions: [fieldSetInclusion()],
            fieldSetInclusionIssues: [],
            fieldSetInclusionRules: {} as ApplicationFactoryRules,
        },
    });

    it('shows the section, listing existing inclusions, only for the Selector segment', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[0]); // the Selector row
        const drawer = within(document.querySelector('.drawer-panel') as HTMLElement);

        expect(drawer.getByText('Field set inclusions')).toBeTruthy();
        expect(drawer.getByText('AccountTierFields')).toBeTruthy();
    });

    it('hides the section entirely when editing the Domain binding on the same SObject', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[1]); // the Domain row

        expect(screen.queryByText('Field set inclusions')).toBeNull();
    });

    it('Add posts submitFieldSetInclusion create with a suggested developer name and no bindingType field', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[0]);
        await fireEvent.input(screen.getByLabelText('Field set API name'), { target: { value: 'BillingSummary' } });
        await fireEvent.click(document.querySelector('.fsi-add-row button') as HTMLButtonElement);

        expect(postMessage).toHaveBeenCalledWith({
            command: 'submitFieldSetInclusion',
            mode: 'create',
            input: { developerName: 'Account_BillingSummary_Inclusion', sobject: 'Account', sobjectAlternate: false, fieldsetName: 'BillingSummary' },
        });
    });

    it('Remove posts submitFieldSetInclusion update with isActive: false', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[0]);
        await fireEvent.click(screen.getByLabelText('Remove AccountTierFields'));

        expect(postMessage).toHaveBeenCalledWith({
            command: 'submitFieldSetInclusion',
            mode: 'update',
            input: { developerName: 'Account_TierFields', isActive: false },
        });
    });

    it('fieldSetInclusionsUpdated updates the list in place — the drawer stays open, unlike a binding save', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[0]);
        await fireEvent.click(screen.getByLabelText('Remove AccountTierFields'));

        window.dispatchEvent(new MessageEvent('message', { data: { command: 'fieldSetInclusionsUpdated', records: [] } }));
        await Promise.resolve();

        expect(screen.getByText('Edit selector binding')).toBeTruthy(); // still open
        // The drawer's own copy is gone; the sheet behind it (never remounted for this targeted write —
        // see docs/design/0017's Stage 4 implementation note) still shows its now-stale nested row.
        const drawer = within(document.querySelector('.drawer-panel') as HTMLElement);
        expect(drawer.queryByText('AccountTierFields')).toBeNull();
        expect(document.querySelector('.sb-fsi-row .sb-fsi-name')?.textContent).toBe('AccountTierFields');
    });

    it('fieldSetInclusionBlocked shows the wiring-problem panel without closing the drawer', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[0]);
        await fireEvent.input(screen.getByLabelText('Field set API name'), { target: { value: 'DupeFields' } });
        await fireEvent.click(document.querySelector('.fsi-add-row button') as HTMLButtonElement);

        window.dispatchEvent(
            new MessageEvent('message', { data: { command: 'fieldSetInclusionBlocked', issues: [{ severity: 'error', rule: 'duplicate-fieldset-name', message: 'Already used.' }] } }),
        );
        await Promise.resolve();

        expect(screen.getByText('This would introduce a wiring problem')).toBeTruthy();
        expect(screen.getByText('Already used.')).toBeTruthy();
        expect(screen.getByText('Edit selector binding')).toBeTruthy();
    });

    it('fieldSetInclusionError shows the error text without closing the drawer', async () => {
        render(App, { props: { initial } });

        await fireEvent.click(screen.getAllByTitle('Edit this binding')[0]);
        await fireEvent.input(screen.getByLabelText('Field set API name'), { target: { value: 'BillingSummary' } });
        await fireEvent.click(document.querySelector('.fsi-add-row button') as HTMLButtonElement);

        window.dispatchEvent(new MessageEvent('message', { data: { command: 'fieldSetInclusionError', message: 'Could not reach the org.' } }));
        await Promise.resolve();

        expect(screen.getByText('Could not reach the org.')).toBeTruthy();
        expect(screen.getByText('Edit selector binding')).toBeTruthy();
    });

    it('nests the field set inclusion as its own row under the Selector row on the SObject Bindings sheet', async () => {
        render(App, { props: { initial } });

        expect(document.querySelector('.sb-fsi-row .sb-fsi-name')?.textContent).toBe('AccountTierFields');
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
            standardObjects: ['Account'], fieldSetInclusions: [], fieldSetInclusionIssues: [], fieldSetInclusionRules: {} as ApplicationFactoryRules,
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

        expect(screen.getByText('Edit Unit of Work binding')).toBeTruthy();
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
