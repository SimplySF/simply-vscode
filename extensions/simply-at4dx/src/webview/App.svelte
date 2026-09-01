<script lang="ts">
    import { untrack } from 'svelte';
    import ApplicationFactoryForm from './ApplicationFactoryForm.svelte';
    import ApplicationFactoryIssuesSection from './ApplicationFactoryIssuesSection.svelte';
    import BindingForm from './BindingForm.svelte';
    import BindingSections from './BindingSections.svelte';
    import IssuesSection from './IssuesSection.svelte';
    import NewBindingMenu from './NewBindingMenu.svelte';
    import PlatformEventForm from './PlatformEventForm.svelte';
    import PlatformEventIssuesSection from './PlatformEventIssuesSection.svelte';
    import PlatformEventSimulateDrawer from './PlatformEventSimulateDrawer.svelte';
    import PlatformEventsSheet from './PlatformEventsSheet.svelte';
    import ServiceBindingsSection from './ServiceBindingsSection.svelte';
    import SObjectBindingsSheet from './SObjectBindingsSheet.svelte';
    import SummaryBar from './SummaryBar.svelte';
    import Toolbar from './Toolbar.svelte';
    import { applicationFactoryRowToFormInitial, partitionBySeverity } from './lib/applicationFactoryView';
    import { FAMILY_ITEMS, availableFamilies, buildSections, headerParts, issuesByRecord, partitionIssues } from './lib/bindingView';
    import { partitionPlatformEventIssuesBySeverity } from './lib/platformEventView';
    import type { ApplicationFactoryViewRow, UnitOfWorkViewRow } from './lib/applicationFactoryView';
    import type {
        ApplicationFactoryFormInitial,
        ApplicationFactoryRules,
        BindingFormInitial,
        DomainProcessBindingRow,
        DomainProcessBindingRules,
        ExplorerKey,
        FamilyKey,
        InitialState,
        PlatformEventFormInitial,
        PlatformEventSubscriptionIssueRule,
        PlatformEventSubscriptionRuleInfo,
        RawPlatformEventSubscriptionRecord,
        WritableBindingType,
    } from './types';
    import { postMessage } from './vscodeApi';

    let { initial: initialProp }: { initial: InitialState } = $props();
    // `initial` never changes after mount — every state transition (including switching explorer tabs,
    // see docs/design/0016) replaces the whole webview (see docs/design/0011's "re-render model"), so
    // this component is always freshly mounted with a new `window.__INITIAL_STATE__` rather than
    // receiving updated props in place. Snapshotting the prop once via `untrack` (rather than reading it
    // directly, which the compiler otherwise flags as `state_referenced_locally`) makes that "read once"
    // intent explicit instead of a suppressed warning.
    const initial = untrack(() => initialProp);

    const domainProcess = initial.domainProcess;
    const rows = domainProcess.kind === 'data' ? domainProcess.rows : [];
    const issues = domainProcess.kind === 'data' ? domainProcess.issues : [];
    // Never read when `domainProcess.kind !== 'data'` (every consumer below only renders in the data
    // view) — the cast just satisfies the type for a value nothing else in this branch will look at.
    const rules = domainProcess.kind === 'data' ? domainProcess.rules : ({} as DomainProcessBindingRules);
    const canWrite = domainProcess.kind === 'data';
    const isLocalScan = initial.isLocalScan ?? false;

    const applicationFactory = initial.applicationFactory;
    const afRules = applicationFactory.kind === 'data' ? applicationFactory.rules : ({} as ApplicationFactoryRules);
    const afCanWrite = applicationFactory.kind === 'data';
    const afStandardObjects = applicationFactory.kind === 'data' ? applicationFactory.standardObjects : [];

    // The "Application Factory" tab from docs/design/0016 is now two tabs — SObject Bindings and Service
    // Bindings — sharing the one lazily-triggered scan (`initial.active` stays 'applicationFactory' on
    // the host side). Which sub-tab is showing is host-side state too (`initial.applicationFactoryTab`),
    // not purely client-side like `afView` — a full re-render remounts the whole webview (docs/design/0011),
    // so a client-only default would otherwise snap back to SObject Bindings any time a write or rescan
    // re-renders the panel while Service Bindings is showing.
    let afTab = $state<'sobject' | 'service'>(initial.applicationFactoryTab ?? 'sobject');
    let sobjectBindingCount = $derived(applicationFactory.kind === 'data' ? applicationFactory.rows.filter((row) => row.bindingType !== 'Service').length : undefined);
    let serviceBindingCount = $derived(applicationFactory.kind === 'data' ? applicationFactory.rows.filter((row) => row.bindingType === 'Service').length : undefined);
    let afIssuesForTab = $derived(
        applicationFactory.kind === 'data'
            ? applicationFactory.issues.filter((issue) => (afTab === 'service' ? issue.bindingType === 'Service' : issue.bindingType !== 'Service'))
            : [],
    );
    let afProblems = $derived(partitionBySeverity(afIssuesForTab));

    function selectExplorer(explorer: ExplorerKey, afTabArg?: 'sobject' | 'service'): void {
        if (explorer === initial.active) {
            return;
        }
        postMessage(explorer === 'applicationFactory' ? { command: 'selectExplorer', explorer, afTab: afTabArg } : { command: 'selectExplorer', explorer });
    }

    function selectSObjectBindingsTab(): void {
        afTab = 'sobject';
        selectExplorer('applicationFactory', 'sobject');
    }

    function selectServiceBindingsTab(): void {
        afTab = 'service';
        selectExplorer('applicationFactory', 'service');
    }

    let afView = $state<'list' | 'form'>('list');
    let afFormMode = $state<'create' | 'edit'>('create');
    let afFormInitial = $state<ApplicationFactoryFormInitial>({});

    /**
     * Opens the create drawer, always with a fixed `bindingType` — `NewBindingMenu`'s own choice on the
     * SObject Bindings tab (Selector/Domain/Unit of Work — canvas 1c), or `'Service'` on the Service
     * Bindings tab, which has no menu to choose from (Service is the only type there). The drawer never
     * lets you switch types afterward — see docs/design/0017's Stage 1 Behavior section.
     */
    function openCreateApplicationFactoryForm(bindingType: WritableBindingType): void {
        afFormMode = 'create';
        afFormInitial = { bindingType };
        afView = 'form';
    }

    function openAddGapBinding(bindingType: 'Domain' | 'UnitOfWork', sobject: string): void {
        afFormMode = 'create';
        afFormInitial = { bindingType, sobject };
        afView = 'form';
    }

    function openEditApplicationFactoryForm(row: ApplicationFactoryViewRow | UnitOfWorkViewRow): void {
        afFormMode = 'edit';
        afFormInitial = applicationFactoryRowToFormInitial(row);
        afView = 'form';
    }

    function closeApplicationFactoryForm(): void {
        afView = 'list';
    }

    // Platform Events tab — see docs/design/0018. Its own three-state view (list/form/simulate) mirrors
    // Application Factory's list/form split, with `'simulate'` added for the match-simulator drawer (7b),
    // which isn't a create/edit form at all.
    const platformEvents = initial.platformEvents;
    const peRules = platformEvents.kind === 'data' ? platformEvents.rules : ({} as Record<PlatformEventSubscriptionIssueRule, PlatformEventSubscriptionRuleInfo>);
    const peCanWrite = platformEvents.kind === 'data';
    const peRecords = $derived(platformEvents.kind === 'data' ? platformEvents.records : []);
    let peProblems = $derived(platformEvents.kind === 'data' ? partitionPlatformEventIssuesBySeverity(platformEvents.issues) : { errors: [], warnings: [] });
    let peBusCount = $derived(new Set(peRecords.map((record) => record.eventBus)).size);

    let peView = $state<'list' | 'form' | 'simulate'>('list');
    let peFormMode = $state<'create' | 'edit'>('create');
    let peFormInitial = $state<PlatformEventFormInitial>({});

    function openCreatePlatformEvent(): void {
        peFormMode = 'create';
        peFormInitial = {};
        peView = 'form';
    }

    function openEditPlatformEvent(record: RawPlatformEventSubscriptionRecord): void {
        peFormMode = 'edit';
        peFormInitial = { ...record };
        peView = 'form';
    }

    function closePlatformEventForm(): void {
        peView = 'list';
    }

    function openSimulate(): void {
        peView = 'simulate';
    }

    function closeSimulate(): void {
        peView = 'list';
    }

    let sobjects = $derived([...new Set(rows.map((row) => row.sobject))].sort((a, b) => a.localeCompare(b)));
    let sobject = $state(untrack(() => sobjects[0]) ?? '');

    let sobjectRows = $derived(rows.filter((row) => row.sobject === sobject));
    let familyItems = $derived(FAMILY_ITEMS.filter((item) => availableFamilies(sobjectRows).has(item.value)));
    let family = $state<FamilyKey | undefined>(untrack(() => familyItems[0]?.value));

    // Mirrors the old CLIENT_SCRIPT's `populateFamilyOptions` rebuilding the <select>'s options (and the
    // browser defaulting to the first one) every time the SObject selection changes.
    $effect(() => {
        if (!familyItems.some((item) => item.value === family)) {
            family = familyItems[0]?.value;
        }
    });

    let sections = $derived(family ? buildSections(family, sobjectRows) : []);
    let familyLabel = $derived(familyItems.find((item) => item.value === family)?.label ?? '');
    let recordIssues = $derived(issuesByRecord(issues));
    let issuePartition = $derived(partitionIssues(issues, sobject));
    let header = $derived(family ? headerParts(sobject, family) : undefined);
    let bindingCount = $derived(sections.reduce((n, section) => n + section.rows.length, 0));

    let view = $state<'list' | 'form'>('list');
    let formMode = $state<'create' | 'edit'>('create');
    let formInitial = $state<BindingFormInitial>({});

    function openCreateForm(): void {
        formMode = 'create';
        formInitial = {
            sobject,
            processContext: family === 'DomainMethod' ? 'DomainMethodExecution' : 'TriggerExecution',
            type: 'Action',
            isActive: true,
        };
        view = 'form';
    }

    function openEditForm(row: DomainProcessBindingRow): void {
        formMode = 'edit';
        formInitial = row;
        view = 'form';
    }

    function closeForm(): void {
        view = 'list';
    }
</script>

<div class="explorer-tabs" role="tablist">
    <button
        type="button"
        role="tab"
        class="explorer-tab"
        class:explorer-tab-active={initial.active === 'applicationFactory' && afTab === 'sobject'}
        aria-selected={initial.active === 'applicationFactory' && afTab === 'sobject'}
        onclick={selectSObjectBindingsTab}
    >
        SObject Bindings
        {#if sobjectBindingCount !== undefined && afView === 'list'}
            <span class="explorer-tab-badge">{sobjectBindingCount}</span>
        {/if}
    </button>
    <button
        type="button"
        role="tab"
        class="explorer-tab"
        class:explorer-tab-active={initial.active === 'domainProcess'}
        aria-selected={initial.active === 'domainProcess'}
        onclick={() => selectExplorer('domainProcess')}
    >
        Domain Process Bindings
        {#if domainProcess.kind === 'data' && view === 'list'}
            <span class="explorer-tab-badge">{bindingCount}</span>
        {/if}
    </button>
    <button
        type="button"
        role="tab"
        class="explorer-tab"
        class:explorer-tab-active={initial.active === 'applicationFactory' && afTab === 'service'}
        aria-selected={initial.active === 'applicationFactory' && afTab === 'service'}
        onclick={selectServiceBindingsTab}
    >
        Service Bindings
        {#if serviceBindingCount !== undefined && afView === 'list'}
            <span class="explorer-tab-badge">{serviceBindingCount}</span>
        {/if}
    </button>
    <button
        type="button"
        role="tab"
        class="explorer-tab"
        class:explorer-tab-active={initial.active === 'platformEvents'}
        aria-selected={initial.active === 'platformEvents'}
        onclick={() => selectExplorer('platformEvents')}
    >
        Platform Events
        {#if platformEvents.kind === 'data' && peView === 'list'}
            <span class="explorer-tab-badge">{platformEvents.records.length}</span>
        {/if}
    </button>
    <span class="explorer-tabs-spacer"></span>
    {#if initial.sourceLabel}
        <span class="explorer-tabs-source" title={initial.sourceLabel}>{initial.sourceLabel}</span>
    {/if}
</div>

{#if initial.active === 'domainProcess'}
    {#if domainProcess.kind === 'data' && view === 'list'}
        <Toolbar {sobjects} bind:sobject bind:family {familyItems} {canWrite} onNewBinding={openCreateForm} />
    {:else if domainProcess.kind !== 'data'}
        <div class="toolbar">
            <label>
                SObject
                <select disabled><option>{domainProcess.kind === 'loading' ? 'Loading…' : '—'}</option></select>
            </label>
            <label>
                Trigger Event
                <select disabled><option>{domainProcess.kind === 'loading' ? 'Loading…' : '—'}</option></select>
            </label>
            <span class="spacer"></span>
            <button disabled>+ New Binding</button>
        </div>
    {/if}
{:else if initial.active === 'applicationFactory'}
    {#if applicationFactory.kind === 'data' && afView === 'list'}
        <div class="toolbar">
            <span class="spacer"></span>
            {#if afTab === 'sobject'}
                <NewBindingMenu onSelect={openCreateApplicationFactoryForm} />
            {:else}
                <button onclick={() => openCreateApplicationFactoryForm('Service')}>+ New Binding</button>
            {/if}
        </div>
    {:else if applicationFactory.kind !== 'data'}
        <div class="toolbar">
            <span class="spacer"></span>
            {#if afTab === 'sobject'}
                <NewBindingMenu disabled onSelect={() => {}} />
            {:else}
                <button disabled>+ New Binding</button>
            {/if}
        </div>
    {/if}
{:else if initial.active === 'platformEvents'}
    {#if platformEvents.kind === 'data' && peView === 'list'}
        <div class="toolbar">
            <span class="spacer"></span>
            <button class="secondary" onclick={openSimulate} disabled={platformEvents.records.length === 0}>Simulate a match…</button>
            <button onclick={openCreatePlatformEvent}>+ New Subscription</button>
        </div>
    {:else if platformEvents.kind !== 'data'}
        <div class="toolbar">
            <span class="spacer"></span>
            <button class="secondary" disabled>Simulate a match…</button>
            <button disabled>+ New Subscription</button>
        </div>
    {/if}
{/if}

<div
    id="content"
    inert={(initial.active === 'domainProcess' && view === 'form') ||
        (initial.active === 'applicationFactory' && afView === 'form') ||
        (initial.active === 'platformEvents' && peView !== 'list')}
>
    {#if initial.active === 'domainProcess'}
        {#if domainProcess.kind === 'loading'}
            <p class="status">Scanning workspace for AT4DX bindings…</p>
        {:else if domainProcess.kind === 'error'}
            <p class="status error">
                {#each domainProcess.message.split('\n') as line, i (i)}{#if i > 0}<br />{/if}{line}{/each}
            </p>
        {:else if domainProcess.kind === 'empty'}
            <p class="status">No AT4DX Trigger Action Framework bindings found.</p>
        {:else}
            {#if header}
                <div class="header">
                    <div class="header-text">
                        {#if header.isDomainMethod}
                            When {header.article} <strong>{header.sobject}</strong> domain method
                            <strong>{header.verb}</strong>, {bindingCount} binding{bindingCount === 1 ? '' : 's'}
                            {bindingCount === 1 ? 'is' : 'are'} evaluated in order.
                        {:else}
                            When {header.article} <strong>{header.sobject}</strong> record is
                            <strong>{header.verb}</strong>, {bindingCount} binding{bindingCount === 1 ? '' : 's'}
                            {bindingCount === 1 ? 'is' : 'are'} evaluated in order.
                        {/if}
                    </div>
                    <SummaryBar inView={issuePartition.inView} elsewhere={issuePartition.elsewhere} />
                </div>
            {/if}
            <BindingSections {sections} issuesByRecord={recordIssues} {rules} onEdit={openEditForm} />
            <IssuesSection inView={issuePartition.inView} elsewhere={issuePartition.elsewhere} {sobject} clickable={isLocalScan} {rules} />
        {/if}
    {:else if initial.active === 'applicationFactory'}
        {#if applicationFactory.kind === 'loading'}
            <p class="status">Scanning workspace for Application Factory bindings…</p>
        {:else if applicationFactory.kind === 'error'}
            <p class="status error">
                {#each applicationFactory.message.split('\n') as line, i (i)}{#if i > 0}<br />{/if}{line}{/each}
            </p>
        {:else if applicationFactory.kind === 'empty'}
            <p class="status">No AT4DX Application Factory bindings found.</p>
        {:else if afTab === 'sobject'}
            <SObjectBindingsSheet
                rows={applicationFactory.kind === 'data' ? applicationFactory.rows : []}
                domainProcessRows={domainProcess.kind === 'data' ? domainProcess.rows : undefined}
                fieldSetInclusions={applicationFactory.kind === 'data' ? applicationFactory.fieldSetInclusions : []}
                canWrite={afCanWrite}
                lastBatchResult={initial.lastBatchResult}
                onEdit={openEditApplicationFactoryForm}
                onAdd={openAddGapBinding}
            />
            <ApplicationFactoryIssuesSection errors={afProblems.errors} warnings={afProblems.warnings} clickable={isLocalScan} rules={afRules} />
        {:else}
            <ServiceBindingsSection rows={applicationFactory.kind === 'data' ? applicationFactory.rows : []} canWrite={afCanWrite} onEdit={openEditApplicationFactoryForm} />
            <ApplicationFactoryIssuesSection errors={afProblems.errors} warnings={afProblems.warnings} clickable={isLocalScan} rules={afRules} />
        {/if}
    {:else if initial.active === 'platformEvents'}
        {#if platformEvents.kind === 'loading'}
            <p class="status">Scanning workspace for platform event subscriptions…</p>
        {:else if platformEvents.kind === 'error'}
            <p class="status error">
                {#each platformEvents.message.split('\n') as line, i (i)}{#if i > 0}<br />{/if}{line}{/each}
            </p>
        {:else if platformEvents.kind === 'empty'}
            <p class="status">No AT4DX Platform Event Distributor subscriptions found.</p>
        {:else}
            <div class="header">
                <div class="header-text">
                    {peRecords.length} subscription{peRecords.length === 1 ? '' : 's'} across {peBusCount} event bus{peBusCount === 1 ? '' : 'es'}. Each consumer subscribes
                    once — <strong>Consumer__c</strong> is unique.
                </div>
                {#if peProblems.errors.length + peProblems.warnings.length > 0}
                    <span class="pe-problems-chip">⚠ {peProblems.errors.length + peProblems.warnings.length} problem{peProblems.errors.length + peProblems.warnings.length === 1 ? '' : 's'}</span>
                {/if}
            </div>
            <PlatformEventsSheet records={peRecords} issues={platformEvents.kind === 'data' ? platformEvents.issues : []} canWrite={peCanWrite} onEdit={openEditPlatformEvent} />
            <PlatformEventIssuesSection errors={peProblems.errors} warnings={peProblems.warnings} clickable={isLocalScan} rules={peRules} />
        {/if}
    {/if}
</div>

{#if (initial.active === 'domainProcess' && view === 'form') || (initial.active === 'applicationFactory' && afView === 'form') || (initial.active === 'platformEvents' && peView !== 'list')}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="drawer-backdrop"
        onclick={initial.active === 'domainProcess' ? closeForm : initial.active === 'applicationFactory' ? closeApplicationFactoryForm : peView === 'simulate' ? closeSimulate : closePlatformEventForm}
    ></div>
    <div class="drawer-panel" role="dialog" aria-modal="true">
        {#if initial.active === 'domainProcess'}
            <BindingForm mode={formMode} initial={formInitial} {rules} scopeSobject={sobject} scopeLabel={familyLabel} onCancel={closeForm} />
        {:else if initial.active === 'applicationFactory'}
            <ApplicationFactoryForm
                mode={afFormMode}
                initial={afFormInitial}
                rules={afRules}
                standardObjects={afStandardObjects}
                allRows={applicationFactory.kind === 'data' ? applicationFactory.rows : []}
                domainProcessRows={domainProcess.kind === 'data' ? domainProcess.rows : undefined}
                fieldSetInclusions={applicationFactory.kind === 'data' ? applicationFactory.fieldSetInclusions : []}
                onCancel={closeApplicationFactoryForm}
            />
        {:else if peView === 'simulate'}
            <PlatformEventSimulateDrawer records={peRecords} onCancel={closeSimulate} />
        {:else}
            <PlatformEventForm mode={peFormMode} initial={peFormInitial} rules={peRules} onCancel={closePlatformEventForm} />
        {/if}
    </div>
{/if}

<style>
    :global(body) {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        padding: 16px;
    }
    /* Create/edit drawer — a panel, not a full-screen replacement of the list behind it (canvas Turns
       2-4 draw every drawer at 520-560px, floating over the sheet). */
    :global(.drawer-backdrop) {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        z-index: 100;
    }
    :global(.drawer-panel) {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(520px, 100vw);
        padding: 16px;
        background: var(--vscode-editor-background);
        border-left: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        box-shadow: -8px 0 24px rgba(0, 0, 0, 0.35);
        overflow-y: auto;
        z-index: 101;
    }
    :global(.explorer-tabs) {
        display: flex;
        align-items: stretch;
        gap: 0;
        height: 40px;
        margin: -16px -16px 16px;
        padding: 0 20px;
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.explorer-tab) {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 14px;
        background: none;
        border: 0;
        border-bottom: 2px solid transparent;
        font: inherit;
        font-size: 0.95em;
        color: var(--vscode-foreground);
        white-space: nowrap;
        cursor: pointer;
    }
    :global(button.explorer-tab:focus-visible) {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -2px;
    }
    :global(.explorer-tab-active) {
        border-bottom-color: var(--vscode-focusBorder);
        font-weight: 500;
    }
    :global(.explorer-tab-inert) {
        color: var(--vscode-descriptionForeground);
        cursor: default;
    }
    :global(.explorer-tab-badge) {
        padding: 1px 7px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        border-radius: 9px;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.75em;
    }
    :global(.explorer-tab-soon) {
        font-size: 0.75em;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    :global(.explorer-tabs-spacer) {
        flex: 1;
    }
    :global(.explorer-tabs-source) {
        display: flex;
        align-items: center;
        max-width: 260px;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.toolbar) {
        display: flex;
        align-items: flex-end;
        gap: 16px;
        margin-bottom: 16px;
    }
    :global(.toolbar label) {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.toolbar select) {
        min-width: 220px;
        padding: 4px 6px;
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border));
        border-radius: 4px;
    }
    :global(.toolbar select:disabled) {
        opacity: 0.6;
    }
    :global(.toolbar .spacer) {
        flex: 1;
    }
    :global(button) {
        font-family: inherit;
        font-size: 0.9em;
        padding: 6px 14px;
        border-radius: 4px;
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        cursor: pointer;
    }
    :global(button:hover) {
        background: var(--vscode-button-hoverBackground);
    }
    :global(button:disabled) {
        opacity: 0.6;
        cursor: default;
    }
    :global(button.secondary) {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }
    :global(button.secondary:hover) {
        background: var(--vscode-button-secondaryHoverBackground);
    }
    :global(.row-edit) {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        flex-shrink: 0;
        color: var(--vscode-descriptionForeground);
        border-radius: 4px;
    }
    :global(.row-edit:hover) {
        color: var(--vscode-foreground);
        background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
    }
    :global(.row-edit svg) {
        width: 14px;
        height: 14px;
    }
    :global(.status) {
        color: var(--vscode-descriptionForeground);
    }
    :global(.status.error) {
        color: var(--vscode-errorForeground);
    }
    :global(.summary) {
        flex-shrink: 0;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 0.9em;
        white-space: nowrap;
    }
    :global(.summary.clean) {
        color: var(--vscode-descriptionForeground);
    }
    :global(.summary.problem) {
        color: var(--vscode-editorWarning-foreground);
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        cursor: pointer;
    }
    :global(.summary.problem:hover) {
        text-decoration: underline;
    }
    :global(.header) {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 20px;
        margin-bottom: 16px;
        background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        border-radius: 6px;
    }
    :global(.header-text) {
        flex: 1;
        font-size: 1.05em;
        line-height: 1.45;
        text-wrap: pretty;
    }
    :global(.section) {
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        border-radius: 6px;
        margin-bottom: 16px;
        overflow: hidden;
    }
    :global(.section-header) {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.section-title) {
        font-weight: 600;
    }
    :global(.section-count) {
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.row-grid) {
        display: grid;
        grid-template-columns: 56px 84px minmax(0, 1fr) 68px 100px 108px minmax(0, auto) 78px 34px;
        align-items: center;
        gap: 12px;
        padding: 0 20px;
    }
    :global(.col-header) {
        height: 24px;
        font-size: 0.8em;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.col-header > :nth-child(4)),
    :global(.col-header > :nth-child(5)),
    :global(.col-header > :nth-child(6)) {
        text-align: center;
    }
    :global(.row) {
        height: 40px;
        border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        cursor: pointer;
    }
    :global(.row:hover) {
        background: var(--vscode-list-hoverBackground);
    }
    :global(.row.inactive) {
        opacity: 0.55;
    }
    :global(.row-order) {
        font-family: var(--vscode-editor-font-family);
        color: var(--vscode-descriptionForeground);
    }
    :global(.type-pill) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        justify-self: start;
        padding: 3px 8px;
        border: 1px solid var(--vscode-charts-orange);
        border-radius: 4px;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.8em;
        letter-spacing: 0.05em;
        color: var(--vscode-charts-orange);
        text-transform: uppercase;
        white-space: nowrap;
    }
    :global(.type-pill.type-criteria) {
        border-color: var(--vscode-charts-blue);
        color: var(--vscode-charts-blue);
    }
    :global(.type-pill.type-inactive) {
        border-color: var(--vscode-descriptionForeground);
        color: var(--vscode-descriptionForeground);
    }
    :global(.type-pill.type-pill-dashed) {
        border-style: dashed;
    }
    :global(.row-class) {
        font-family: var(--vscode-editor-font-family);
        color: var(--vscode-textLink-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    :global(.row-flag) {
        color: var(--vscode-foreground);
        text-align: center;
    }
    :global(.row-flag.row-flag-off) {
        color: var(--vscode-descriptionForeground);
    }
    :global(.row-async) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        color: var(--vscode-foreground);
    }
    :global(.row-async.row-flag-off) {
        color: var(--vscode-descriptionForeground);
    }
    :global(.row-async-icon) {
        display: inline-flex;
        width: 11px;
        height: 11px;
        color: var(--vscode-descriptionForeground);
        flex-shrink: 0;
    }
    :global(.row-async-icon svg) {
        width: 11px;
        height: 11px;
    }
    :global(.row-badges) {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        min-width: 0;
        overflow: hidden;
    }
    :global(.row-status) {
        display: flex;
        align-items: center;
        justify-content: flex-start;
    }
    :global(.status-indicator) {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
    }
    :global(.status-indicator.status-active) {
        color: var(--vscode-charts-green);
    }
    :global(.status-dot) {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        border: 1px solid var(--vscode-descriptionForeground);
        flex-shrink: 0;
    }
    :global(.status-indicator.status-active .status-dot) {
        background: var(--vscode-charts-green);
        border-color: var(--vscode-charts-green);
    }
    @media (max-width: 700px) {
        :global(.row-grid) {
            grid-template-columns: 56px 84px minmax(0, 1fr) 68px minmax(0, auto) 78px 34px;
        }
        :global(.row-grid > :nth-child(5)),
        :global(.row-grid > :nth-child(6)) {
            display: none;
        }
    }
    :global(.seq-group) {
        margin: 0 14px 10px;
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        border-radius: 5px;
        overflow: hidden;
    }
    :global(.seq-group:last-child) {
        margin-bottom: 14px;
    }
    :global(.seq-caption) {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        height: 32px;
        padding: 0 12px;
        background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
        border: 0;
        color: var(--vscode-foreground);
        font: inherit;
        text-align: left;
        cursor: pointer;
    }
    :global(.seq-caption:hover) {
        background: var(--vscode-list-hoverBackground);
    }
    :global(.seq-caption:focus-visible) {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
    }
    :global(.seq-chevron) {
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.seq-prefix) {
        font-family: var(--vscode-editor-font-family);
        font-weight: 700;
        font-size: 0.9em;
    }
    :global(.seq-summary) {
        font-size: 0.9em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.seq-issues) {
        font-size: 0.85em;
        color: var(--vscode-editorWarning-foreground);
        white-space: nowrap;
    }
    :global(.seq-issues.error) {
        color: var(--vscode-editorError-foreground);
    }
    :global(.seq-range) {
        margin-left: auto;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.seq-group .row-grid) {
        padding: 0 12px 0 6px;
    }
    :global(.col-header-banded) {
        padding: 0 34px 0 20px;
    }
    :global(.seq-group .row:first-of-type) {
        border-top-color: var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.badge) {
        font-size: 0.8em;
        padding: 2px 10px;
        border-radius: 999px;
        border: 1px solid transparent;
        white-space: nowrap;
    }
    :global(.badge.error) {
        color: var(--vscode-editorError-foreground);
        border-color: var(--vscode-editorError-foreground);
    }
    :global(.badge.warning) {
        color: var(--vscode-editorWarning-foreground);
        border-color: var(--vscode-editorWarning-foreground);
    }
    :global(.pill) {
        display: inline-flex;
        align-items: center;
        height: 24px;
        padding: 0 10px;
        border-radius: 999px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        font-size: 0.85em;
        white-space: nowrap;
    }
    :global(.empty) {
        color: var(--vscode-descriptionForeground);
    }
    :global(.issues) {
        margin-top: 4px;
    }
    :global(.issues .section-header) {
        display: block;
    }
    :global(.issue) {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 8px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.issue:last-child) {
        border-bottom: none;
    }
    :global(.issue.clickable) {
        cursor: pointer;
    }
    :global(.issue.clickable:hover) {
        background: var(--vscode-list-hoverBackground);
    }
    :global(.issue-icon.error) {
        color: var(--vscode-editorError-foreground);
    }
    :global(.issue-icon.warning) {
        color: var(--vscode-editorWarning-foreground);
    }
    :global(.issue-title) {
        font-weight: 600;
    }
    :global(.issue-meta) {
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
    }
    :global(.issue-message) {
        flex-basis: 100%;
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
    }
    :global(.form-context-bar) {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 20px;
        margin: -16px -16px 16px;
        background: var(--vscode-editorWidget-background);
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.form-breadcrumb-link) {
        color: var(--vscode-textLink-foreground);
        cursor: pointer;
    }
    :global(.form-breadcrumb-link:hover) {
        text-decoration: underline;
    }
    :global(.form-breadcrumb-sep) {
        color: var(--vscode-descriptionForeground);
    }
    :global(.form-breadcrumb-current) {
        font-weight: 600;
    }
    :global(.form-context-devname) {
        font-family: var(--vscode-editor-font-family);
        font-weight: 500;
    }
    :global(.form-context-spacer) {
        flex: 1;
    }
    :global(.form-title) {
        font-weight: 600;
    }
    :global(.form-breadcrumb-bar) {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 20px;
        margin: -16px -16px 16px;
        background: var(--vscode-editor-background, var(--vscode-sideBar-background));
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.form-breadcrumb-suffix) {
        font-size: 0.9em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.form-cli-preview) {
        font-family: var(--vscode-editor-font-family);
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground);
        white-space: pre-wrap;
        word-break: break-word;
    }
    :global(.form-scope-strip) {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 11px 20px;
        margin: -16px -16px 16px;
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.form-scope-label) {
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.form-preview) {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding: 13px 15px;
        margin-bottom: 16px;
        background: var(--vscode-editorWidget-background);
        border-left: 2px solid var(--vscode-focusBorder);
        border-radius: 3px;
    }
    :global(.form-preview-eyebrow) {
        font-family: var(--vscode-editor-font-family);
        font-size: 0.8em;
        font-weight: 600;
        letter-spacing: 0.11em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.form-preview-text) {
        font-size: 1.05em;
        line-height: 1.55;
    }
    :global(.mono-link) {
        font-family: var(--vscode-editor-font-family);
        color: var(--vscode-textLink-foreground);
    }
    :global(.form-sections) {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    :global(.form-section) {
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        border-radius: 5px;
    }
    :global(.form-section-header) {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 11px 16px;
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.form-section-badge) {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 19px;
        height: 19px;
        border-radius: 50%;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        font-family: var(--vscode-editor-font-family);
        font-weight: 700;
        font-size: 0.8em;
        flex-shrink: 0;
    }
    :global(.form-section-title) {
        font-weight: 600;
    }
    :global(.required-marker) {
        color: var(--vscode-errorForeground);
    }
    :global(.form-description) {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 16px;
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.toggle-row) {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 30px;
    }
    :global(.toggle) {
        position: relative;
        display: inline-flex;
    }
    :global(.toggle-input) {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        margin: 0;
    }
    :global(.toggle-track) {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        width: 30px;
        height: 17px;
        padding: 2px;
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 9px;
        cursor: pointer;
    }
    :global(.toggle-knob) {
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: var(--vscode-descriptionForeground);
    }
    :global(.toggle-input:checked + .toggle-track) {
        background: var(--vscode-button-background);
        justify-content: flex-end;
    }
    :global(.toggle-input:checked + .toggle-track .toggle-knob) {
        background: var(--vscode-button-foreground);
    }
    :global(.toggle-input:focus-visible + .toggle-track) {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
    }
    :global(.toggle-label) {
        font-size: 1em;
        color: var(--vscode-foreground);
    }
    :global(.segmented) {
        display: flex;
        height: 30px;
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 4px;
        overflow: hidden;
    }
    :global(.segmented-option) {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--vscode-input-background);
        color: var(--vscode-foreground);
        border: none;
        border-radius: 0;
        font-family: inherit;
        font-size: 0.9em;
        font-weight: 400;
        padding: 0;
        cursor: pointer;
    }
    :global(.segmented-option.selected) {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }
    :global(.form-grid) {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px 16px;
        padding: 16px;
    }
    :global(.form-field) {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.form-field.span2) {
        grid-column: 1 / -1;
    }
    :global(.form-field input[type='text']),
    :global(.form-field input[type='number']),
    :global(.form-field select),
    :global(.form-field textarea) {
        font-family: inherit;
        font-size: 1em;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 4px;
        padding: 5px 8px;
    }
    :global(.form-field textarea) {
        resize: vertical;
        min-height: 48px;
        font-family: inherit;
    }
    :global(.form-field input:disabled) {
        opacity: 0.6;
    }
    :global(.form-field .field-invalid) {
        border-color: var(--vscode-inputValidation-errorBorder);
    }
    :global(.form-checkbox) {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 6px;
        font-size: 0.9em;
        color: var(--vscode-foreground);
    }
    :global(.form-checkbox input) {
        margin: 0;
    }
    :global(.form-hint) {
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground);
        font-weight: 400;
    }
    :global(.form-field-error) {
        color: var(--vscode-errorForeground);
        font-size: 0.85em;
        min-height: 1.2em;
    }
    :global(.form-error) {
        color: var(--vscode-errorForeground);
        background: var(--vscode-inputValidation-errorBackground, transparent);
        border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
        border-radius: 4px;
        padding: 8px 12px;
        margin-bottom: 12px;
    }
    :global(.form-issues) {
        margin-bottom: 12px;
    }

    /* Application Factory explorer — see docs/design/0016. */
    :global(.af-row-grid) {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 16px minmax(0, 1fr) 100px 88px 128px 34px;
        align-items: center;
        gap: 12px;
        padding: 0 20px;
    }
    :global(.af-row-grid.no-priority) {
        grid-template-columns: minmax(0, 1fr) 16px minmax(0, 1fr) 88px 128px 34px;
    }
    :global(.uow-row-grid) {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 90px minmax(0, 1.3fr) minmax(0, 1fr) 34px;
        align-items: center;
        gap: 12px;
        padding: 0 20px;
    }
    :global(.af-arrow) {
        color: var(--vscode-descriptionForeground);
        text-align: center;
    }
    :global(.af-priority) {
        font-family: var(--vscode-editor-font-family);
    }
    :global(.af-priority.af-priority-blank) {
        color: var(--vscode-descriptionForeground);
    }
    :global(.af-priority.af-priority-tied) {
        color: var(--vscode-charts-orange);
    }
    :global(.af-resolution-chip) {
        display: inline-flex;
        align-items: center;
        justify-self: start;
        padding: 2px 7px;
        border: 1px solid var(--vscode-descriptionForeground);
        border-radius: 3px;
        font-size: 0.75em;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
    }
    :global(.af-resolution-chip.resolves-today),
    :global(.af-resolution-chip.ambiguous) {
        border-color: var(--vscode-charts-orange);
        color: var(--vscode-charts-orange);
    }
    :global(.af-tie-banner) {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 6px 20px;
        background: var(--vscode-inputValidation-warningBackground, var(--vscode-editorWidget-background));
        border-top: 1px solid var(--vscode-editorWarning-foreground);
        border-bottom: 1px solid var(--vscode-editorWarning-foreground);
        font-size: 0.9em;
    }

    /* SObject Bindings sheet (Stage 1) — see docs/design/0017. */
    :global(.sb-sheet) {
        display: flex;
        flex-direction: column;
        gap: 14px;
        margin-bottom: 16px;
    }
    :global(.sb-card) {
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        border-radius: 6px;
        overflow: hidden;
    }
    :global(.sb-card-header) {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.sb-card-sobject) {
        font-family: var(--vscode-editor-font-family);
        font-weight: 700;
    }
    :global(.sb-card-spacer) {
        flex: 1;
    }
    :global(.sb-card-count) {
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.sb-gap-pill) {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border: 1px solid var(--vscode-charts-orange);
        border-radius: 999px;
        font-size: 0.78em;
        color: var(--vscode-charts-orange);
        white-space: nowrap;
    }
    :global(.sb-row) {
        display: grid;
        grid-template-columns: 104px minmax(0, 1fr) 150px 100px 92px 30px;
        align-items: center;
        gap: 12px;
        padding: 0 16px;
        height: 38px;
        border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.sb-row-gap) {
        display: grid;
        grid-template-columns: 104px minmax(0, 1fr) 30px;
        align-items: center;
        gap: 12px;
        padding: 0 16px;
        height: 38px;
        border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.sb-detail) {
        font-size: 0.9em;
        color: var(--vscode-descriptionForeground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    :global(.sb-value-badge) {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    :global(.sb-gap-message) {
        font-size: 0.9em;
        color: var(--vscode-descriptionForeground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    :global(.sb-gap-warning) {
        color: var(--vscode-charts-orange);
    }
    :global(.sb-add-link) {
        justify-self: end;
        background: none;
        border: 0;
        padding: 0;
        color: var(--vscode-textLink-foreground);
        font: inherit;
        font-size: 0.9em;
        text-decoration: underline;
        cursor: pointer;
    }
    :global(.row-class-static) {
        color: var(--vscode-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    :global(.af-type-pill) {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        justify-self: start;
        padding: 3px 8px;
        border: 1px solid transparent;
        border-radius: 4px;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.78em;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        white-space: nowrap;
    }
    :global(.af-type-selector) {
        border-color: var(--vscode-charts-blue);
        color: var(--vscode-charts-blue);
    }
    :global(.af-type-domain) {
        /* Literal hex, not a vscode token — see SPEC-CONVENTIONS.md's "colors are derivations" rule. */
        border-color: #c586c0;
        color: #c586c0;
    }
    :global(.af-type-uow) {
        border-color: var(--vscode-charts-orange);
        color: var(--vscode-charts-orange);
    }
    :global(.af-type-pill-dashed) {
        border-style: dashed;
    }
    :global(.sb-badge) {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 0.72em;
        font-weight: 600;
        letter-spacing: 0.05em;
    }
    :global(.sb-badge-wins) {
        background: var(--vscode-charts-green);
        color: #14300f;
    }
    :global(.sb-badge-shadowed) {
        background: rgba(255, 255, 255, 0.09);
        color: var(--vscode-descriptionForeground);
    }
    /* Field set inclusion sub-rows, nested under a card's last Selector row (canvas 3a) — see docs/design/0017. */
    :global(.sb-fsi-row) {
        height: 28px;
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        /* Lighter than an ordinary binding row — these are supplementary detail nested under the
           Selector row above them, not a binding in their own right. Same de-emphasis technique as
           `.row.inactive`'s opacity, just a lighter touch since these rows are always "active". */
        opacity: 0.75;
    }
    :global(.sb-fsi-connector) {
        justify-self: end;
        padding-right: 4px;
    }
    :global(.sb-fsi-name) {
        font-family: var(--vscode-editor-font-family);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    :global(.sb-fsi-source) {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* Drag-and-drop reordering (Stage 3) — see docs/design/0017. */
    :global(.sb-card-dragging) {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
    }
    :global(.sb-drag-handle) {
        cursor: grab;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        line-height: 1;
    }
    :global(.sb-drag-handle:active) {
        cursor: grabbing;
    }
    :global(.sb-move-buttons) {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }
    :global(.sb-move-btn) {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 12px;
        padding: 0;
        background: none;
        border: 0;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
    }
    :global(.sb-move-btn:hover:not(:disabled)) {
        color: var(--vscode-foreground);
    }
    :global(.sb-move-btn:disabled) {
        opacity: 0.35;
        cursor: default;
    }
    :global(.sb-move-btn svg) {
        width: 10px;
        height: 10px;
    }
    :global(.sb-collision-banner) {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 6px 16px;
        margin: -1px 0;
        background: rgba(226, 192, 141, 0.11);
        border-top: 1px solid var(--vscode-charts-orange);
        border-bottom: 1px solid var(--vscode-charts-orange);
        font-size: 0.85em;
        color: var(--vscode-foreground);
    }
    :global(.sr-only) {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }
    :global(.pcb-bar) {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 20px;
        margin: 0 0 16px;
        background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
        border: 1px solid var(--vscode-focusBorder);
        border-radius: 6px;
    }
    :global(.pcb-summary-row) {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    :global(.pcb-dot) {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--vscode-focusBorder);
        flex-shrink: 0;
    }
    :global(.pcb-summary) {
        font-size: 0.95em;
    }
    :global(.pcb-spacer) {
        flex: 1;
    }
    :global(.pcb-list) {
        margin: 0;
        padding: 0 0 0 17px;
        font-size: 0.88em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.pcb-batch-result) {
        padding: 10px 16px;
        margin-bottom: 16px;
        border-radius: 4px;
        font-size: 0.9em;
    }
    :global(.pcb-batch-result.ok) {
        background: rgba(137, 209, 133, 0.1);
        border: 1px solid var(--vscode-charts-green);
        color: var(--vscode-foreground);
    }
    :global(.pcb-batch-result.failed) {
        background: rgba(244, 135, 113, 0.1);
        border: 1px solid var(--vscode-errorForeground);
        color: var(--vscode-foreground);
    }

    /* Application Factory create/edit form (stage 2) — see docs/design/0016. */
    :global(.af-sobject-chip) {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        align-self: flex-start;
        height: 22px;
        padding: 0 8px;
        border-radius: 999px;
        background: var(--vscode-badge-background);
        color: var(--vscode-charts-orange);
        font-size: 0.8em;
        letter-spacing: 0.05em;
        white-space: nowrap;
    }
    :global(.af-sobject-chip-clear) {
        background: none;
        border: 0;
        padding: 0;
        color: inherit;
        font: inherit;
        cursor: pointer;
    }
    :global(.af-sobject-hint-ok) {
        color: var(--vscode-charts-green);
    }
    :global(.af-sobject-hint-error) {
        color: var(--vscode-errorForeground);
    }
    :global(.af-sobject-alt-action) {
        background: none;
        border: 0;
        padding: 0;
        margin-left: 6px;
        color: var(--vscode-textLink-foreground);
        font: inherit;
        font-size: 1em;
        text-decoration: underline;
        cursor: pointer;
    }

    /* Field set inclusions (Stage 4) — see docs/design/0017. */
    :global(.fsi-body) {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 13px 16px;
    }
    :global(.fsi-empty) {
        margin: 0;
        font-size: 0.85em;
    }
    :global(.fsi-list) {
        display: flex;
        flex-direction: column;
        gap: 1px;
        margin: 0;
        padding: 0;
        list-style: none;
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        border-radius: 4px;
        overflow: hidden;
    }
    :global(.fsi-row) {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 10px;
        background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    }
    :global(.fsi-row + .fsi-row) {
        border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.fsi-name) {
        flex: 1;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.9em;
    }
    :global(.fsi-source) {
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.fsi-remove) {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        background: none;
        border: 0;
        border-radius: 4px;
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        cursor: pointer;
    }
    :global(.fsi-remove:hover:not(:disabled)) {
        color: var(--vscode-errorForeground);
        background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
    }
    :global(.fsi-remove:disabled) {
        opacity: 0.5;
        cursor: default;
    }
    :global(.fsi-add-row) {
        display: flex;
        gap: 8px;
    }
    :global(.fsi-add-row input) {
        flex: 1;
        font-family: inherit;
        font-size: 1em;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 4px;
        padding: 5px 8px;
    }
    :global(.fsi-note) {
        font-weight: 400;
    }

    /* "+ New Binding" split button and type menu (canvas 1c) — see docs/design/0017. */
    :global(.nbm) {
        position: relative;
        display: inline-flex;
    }
    :global(.nbm-button) {
        display: flex;
        align-items: stretch;
        padding: 0;
        overflow: hidden;
    }
    :global(.nbm-button span:first-child) {
        display: flex;
        align-items: center;
        padding: 6px 12px;
    }
    :global(.nbm-caret) {
        display: flex;
        align-items: center;
        padding: 6px 8px;
        border-left: 1px solid rgba(255, 255, 255, 0.28);
        font-size: 9px;
    }
    :global(.nbm-menu) {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        width: 300px;
        background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
        border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border));
        border-radius: 5px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.36);
        overflow: hidden;
        z-index: 20;
    }
    :global(.nbm-menu-title) {
        padding: 8px 12px 6px;
        font-size: 0.68em;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
    }
    :global(.nbm-item) {
        display: flex;
        flex-direction: column;
        gap: 3px;
        width: 100%;
        padding: 9px 12px;
        background: none;
        border: 0;
        border-top: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.05));
        border-radius: 0;
        text-align: left;
        color: var(--vscode-foreground);
        font: inherit;
        cursor: pointer;
    }
    :global(.nbm-item:first-of-type) {
        border-top: none;
    }
    :global(.nbm-item:hover),
    :global(.nbm-item:focus-visible) {
        background: var(--vscode-list-hoverBackground);
        outline: none;
    }
    :global(.nbm-item-name) {
        font-size: 0.9em;
        font-weight: 500;
    }
    :global(.nbm-item-desc) {
        font-size: 0.78em;
        line-height: 1.45;
        color: var(--vscode-descriptionForeground);
    }
    :global(.nbm-item-desc code) {
        font-family: var(--vscode-editor-font-family);
    }
    :global(.nbm-menu-footer) {
        padding: 8px 12px;
        border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        background: var(--vscode-editor-background);
        font-size: 0.78em;
        line-height: 1.45;
        color: var(--vscode-descriptionForeground);
    }

    /* Platform Events tab (7a-7d) — see docs/design/0018. */
    :global(.pe-problems-chip) {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        font-size: 0.9em;
        color: var(--vscode-charts-red);
    }
    :global(.pe-sheet) {
        display: flex;
        flex-direction: column;
        gap: 14px;
        margin-bottom: 16px;
    }
    :global(.pe-bus) {
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        border-radius: 6px;
        overflow: hidden;
    }
    :global(.pe-bus-header) {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.pe-bus-name) {
        font-family: var(--vscode-editor-font-family);
        font-weight: 700;
    }
    :global(.pe-bus-spacer) {
        flex: 1;
    }
    :global(.pe-bus-count) {
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.pe-category-header) {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 0 16px 0 30px;
        height: 29px;
        background: rgba(255, 255, 255, 0.028);
        border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.pe-category-label) {
        font-family: var(--vscode-editor-font-family);
        font-weight: 500;
        font-size: 0.9em;
        /* Periwinkle — the type hue turn 7 assigns to Platform Events, since the four hues from 1a's
           binding types were already taken. See SPEC-CONVENTIONS.md's derived-color rule. */
        color: #c8c8ff;
    }
    :global(.pe-category-label.pe-category-none) {
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        font-size: 0.78em;
        letter-spacing: 0.05em;
    }
    :global(.pe-category-count) {
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.pe-row) {
        display: grid;
        grid-template-columns: 92px minmax(0, 1fr) 168px 124px 66px 84px 26px;
        align-items: center;
        gap: 11px;
        padding: 0 16px;
        height: 38px;
        border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.pe-col-header) {
        height: 24px;
        font-size: 0.78em;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.pe-row-throws) {
        background: rgba(241, 76, 76, 0.07);
        border-left: 2px solid var(--vscode-charts-red);
    }
    :global(.pe-row-never-fires) {
        background: rgba(226, 192, 141, 0.07);
        border-left: 2px solid var(--vscode-charts-orange);
    }
    :global(.pe-row-inactive) {
        opacity: 0.5;
    }
    :global(.pe-type-pill) {
        display: inline-flex;
        align-items: center;
        justify-self: start;
        padding: 3px 8px;
        border: 1px solid #c8c8ff;
        border-radius: 4px;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.75em;
        letter-spacing: 0.05em;
        color: #c8c8ff;
        white-space: nowrap;
    }
    :global(.pe-event-value) {
        font-family: var(--vscode-editor-font-family);
        color: var(--vscode-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    :global(.pe-event-any) {
        font-family: var(--vscode-editor-font-family);
        color: var(--vscode-descriptionForeground);
    }
    :global(.pe-event-blank) {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 0.9em;
        color: var(--vscode-charts-red);
    }
    :global(.pe-mode) {
        font-size: 0.9em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.pe-mode-async) {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--vscode-charts-blue);
    }
    :global(.status-indicator.pe-status-throws) {
        color: var(--vscode-charts-red);
    }
    :global(.status-indicator.pe-status-throws .status-dot) {
        background: var(--vscode-charts-red);
        border-color: var(--vscode-charts-red);
    }
    :global(.status-indicator.pe-status-never-fires) {
        color: var(--vscode-charts-orange);
    }
    :global(.status-indicator.pe-status-never-fires .status-dot) {
        background: var(--vscode-charts-orange);
        border-color: var(--vscode-charts-orange);
    }
    :global(.pe-hazard-note) {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        padding: 7px 16px 8px 40px;
        font-size: 0.85em;
        line-height: 1.5;
        color: rgba(255, 255, 255, 0.72);
    }
    :global(.pe-hazard-error) {
        background: rgba(241, 76, 76, 0.07);
        border-left: 2px solid var(--vscode-charts-red);
    }
    :global(.pe-hazard-error strong) {
        color: var(--vscode-charts-red);
    }
    :global(.pe-hazard-warning) {
        background: rgba(226, 192, 141, 0.07);
        border-left: 2px solid var(--vscode-charts-orange);
    }
    :global(.pe-hazard-warning strong) {
        color: var(--vscode-charts-orange);
    }

    /* Platform Events match simulator (7b) and create/edit drawer footer (7c) — see docs/design/0018. */
    :global(.pe-sim-fields) {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    :global(.pe-sim-fields-row) {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 11px;
    }
    :global(.pe-sim-results) {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px 16px;
    }
    :global(.pe-sim-summary) {
        font-weight: 600;
    }
    :global(.pe-sim-matches) {
        display: flex;
        flex-direction: column;
        gap: 7px;
    }
    :global(.pe-sim-match) {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 9px 11px;
        background: rgba(137, 209, 133, 0.09);
        border-left: 2px solid var(--vscode-charts-green);
        border-radius: 3px;
    }
    :global(.pe-sim-match-index) {
        font-family: var(--vscode-editor-font-family);
        font-size: 0.8em;
        color: var(--vscode-charts-green);
    }
    :global(.pe-sim-match-consumer) {
        flex: 1;
        font-family: var(--vscode-editor-font-family);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    :global(.pe-sim-match-mode) {
        flex-shrink: 0;
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
    :global(.pe-sim-match-mode.pe-mode-async) {
        color: var(--vscode-charts-blue);
    }
    :global(.pe-sim-section-label) {
        font-size: 0.8em;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
    }
    :global(.pe-sim-misses) {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    :global(.pe-sim-miss) {
        display: flex;
        align-items: baseline;
        gap: 9px;
        font-size: 0.9em;
    }
    :global(.pe-sim-miss-consumer) {
        flex-shrink: 0;
        width: 168px;
        font-family: var(--vscode-editor-font-family);
        color: var(--vscode-descriptionForeground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    :global(.pe-sim-miss-reason) {
        flex: 1;
        color: rgba(255, 255, 255, 0.6);
    }
    :global(.pe-form-footer) {
        padding: 12px 20px;
        margin-top: 4px;
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
    }
</style>
