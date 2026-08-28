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
    let recordIssues = $derived(issuesByRecord(issues));
    let issuePartition = $derived(partitionIssues(issues, sobject));
    let header = $derived(family ? headerParts(sobject, family) : undefined);

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

<div id="summary">
    {#if initial.kind === 'data' && view === 'list'}
        <SummaryBar inView={issuePartition.inView} elsewhere={issuePartition.elsewhere} />
    {/if}
</div>

{#if initial.kind === 'data'}
    <Toolbar {sobjects} bind:sobject bind:family {familyItems} {canWrite} onNewBinding={openCreateForm} />
{:else}
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
        <BindingForm mode={formMode} initial={formInitial} {rules} onCancel={closeForm} />
    {:else}
        {#if header}
            <div class="header">
                <span><Icon name="crown" /></span>
                <div class="header-text">
                    {#if header.isDomainMethod}
                        When a(n) <strong>{header.sobject}</strong> domain method <strong>{header.verb}</strong>
                    {:else}
                        When a(n) <strong>{header.sobject}</strong> record is <strong>{header.verb}</strong>
                    {/if}
                </div>
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
        padding: 8px 12px;
        border-radius: 4px;
        margin-bottom: 12px;
        font-size: 0.9em;
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
        background: var(--vscode-sideBar-background);
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        border-radius: 6px;
        padding: 16px;
        margin-bottom: 16px;
    }
    :global(.header svg) {
        width: 24px;
        height: 24px;
        color: var(--vscode-textLink-foreground);
        flex-shrink: 0;
    }
    :global(.header-text) {
        font-size: 1.05em;
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
    :global(.row) {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        cursor: pointer;
    }
    :global(.row:last-child) {
        border-bottom: none;
    }
    :global(.row:hover) {
        background: var(--vscode-list-hoverBackground);
    }
    :global(.row.inactive) {
        opacity: 0.55;
    }
    :global(.row-icon) {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 18px;
        height: 18px;
        color: var(--vscode-textLink-foreground);
        flex-shrink: 0;
    }
    :global(.row-icon svg) {
        width: 16px;
        height: 16px;
    }
    :global(.async-icon) {
        width: 14px;
        height: 14px;
        color: var(--vscode-descriptionForeground);
    }
    :global(.row-name) {
        flex: 1;
        color: var(--vscode-textLink-foreground);
    }
    :global(.row-order) {
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
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
        font-size: 0.8em;
        padding: 2px 10px;
        border-radius: 999px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
    }
    :global(.pill.inactive) {
        background: transparent;
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
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
    :global(.form-title) {
        font-size: 1.1em;
        font-weight: 600;
        margin-bottom: 4px;
    }
    :global(.form-grid) {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px 16px;
        margin: 16px 0;
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
    :global(.form-actions) {
        display: flex;
        gap: 8px;
        margin-top: 8px;
    }
</style>
