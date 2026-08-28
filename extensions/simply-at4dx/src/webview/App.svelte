<script lang="ts">
    import { untrack } from 'svelte';
    import BindingForm from './BindingForm.svelte';
    import BindingSections from './BindingSections.svelte';
    import Icon from './Icon.svelte';
    import IssuesSection from './IssuesSection.svelte';
    import SummaryBar from './SummaryBar.svelte';
    import Toolbar from './Toolbar.svelte';
    import { FAMILY_ITEMS, availableFamilies, buildSections, headerParts, issuesByRecord, partitionIssues } from './lib/bindingView';
    import type { BindingFormInitial, DomainProcessBindingRow, DomainProcessBindingRules, FamilyKey, InitialState } from './types';

    let { initial: initialProp }: { initial: InitialState } = $props();
    // `initial` never changes after mount — every state transition replaces the whole webview
    // (see docs/design/0011's "re-render model"), so this component is always freshly mounted with a
    // new `window.__INITIAL_STATE__` rather than receiving updated props in place. Snapshotting the
    // prop once via `untrack` (rather than reading it directly, which the compiler otherwise flags as
    // `state_referenced_locally`) makes that "read once" intent explicit instead of a suppressed warning.
    const initial = untrack(() => initialProp);

    const rows = initial.kind === 'data' ? initial.rows : [];
    const issues = initial.kind === 'data' ? initial.issues : [];
    // Never read when `initial.kind !== 'data'` (every consumer below only renders in the data view) —
    // the cast just satisfies the type for a value nothing else in this branch will look at.
    const rules = initial.kind === 'data' ? initial.rules : ({} as DomainProcessBindingRules);
    const canWrite = initial.kind === 'data';
    const isLocalScan = initial.kind === 'data' && initial.isLocalScan;

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

<div class="explorer-tabs">
    <span class="explorer-tab explorer-tab-active">
        <span class="explorer-tab-icon"><Icon name="domainProcess" /></span>
        Domain Process Bindings
        {#if initial.kind === 'data' && view === 'list'}
            <span class="explorer-tab-badge">{bindingCount}</span>
        {/if}
    </span>
    <span class="explorer-tab explorer-tab-inert" title="Application Factory Bindings is not available yet.">
        <span class="explorer-tab-icon"><Icon name="applicationFactory" /></span>
        Application Factory
        <span class="explorer-tab-soon">Coming soon</span>
    </span>
    <span class="explorer-tab explorer-tab-inert" title="Platform Event Distributor is not available yet.">
        <span class="explorer-tab-icon"><Icon name="platformEvent" /></span>
        Platform Events
        <span class="explorer-tab-soon">Coming soon</span>
    </span>
    <span class="explorer-tabs-spacer"></span>
    {#if initial.kind === 'data'}
        <span class="explorer-tabs-source" title={initial.sourceLabel}>{initial.sourceLabel}</span>
    {/if}
</div>

{#if initial.kind === 'data' && view === 'list'}
    <Toolbar {sobjects} bind:sobject bind:family {familyItems} {canWrite} onNewBinding={openCreateForm} />
{:else if initial.kind !== 'data'}
    <div class="toolbar">
        <label>
            SObject
            <select disabled><option>{initial.kind === 'loading' ? 'Loading…' : '—'}</option></select>
        </label>
        <label>
            Trigger Event
            <select disabled><option>{initial.kind === 'loading' ? 'Loading…' : '—'}</option></select>
        </label>
        <span class="spacer"></span>
        <button disabled>+ New Binding</button>
    </div>
{/if}

<div id="content">
    {#if initial.kind === 'loading'}
        <p class="status">Scanning workspace for AT4DX bindings…</p>
    {:else if initial.kind === 'error'}
        <p class="status error">
            {#each initial.message.split('\n') as line, i (i)}{#if i > 0}<br />{/if}{line}{/each}
        </p>
    {:else if initial.kind === 'empty'}
        <p class="status">No AT4DX Trigger Action Framework bindings found.</p>
    {:else if view === 'form'}
        <BindingForm mode={formMode} initial={formInitial} {rules} scopeSobject={sobject} scopeLabel={familyLabel} onCancel={closeForm} />
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
</div>

<style>
    :global(body) {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        padding: 16px;
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
        font-size: 0.95em;
        color: var(--vscode-foreground);
        border-bottom: 2px solid transparent;
        white-space: nowrap;
    }
    :global(.explorer-tab-active) {
        border-bottom-color: var(--vscode-focusBorder);
        font-weight: 500;
    }
    :global(.explorer-tab-inert) {
        color: var(--vscode-descriptionForeground);
        cursor: default;
    }
    :global(.explorer-tab-icon) {
        display: inline-flex;
        width: 14px;
        height: 14px;
        flex-shrink: 0;
    }
    :global(.explorer-tab-icon svg) {
        width: 14px;
        height: 14px;
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
        border: 1px solid var(--vscode-charts-yellow);
        border-radius: 4px;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.8em;
        letter-spacing: 0.05em;
        color: var(--vscode-charts-yellow);
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
</style>
