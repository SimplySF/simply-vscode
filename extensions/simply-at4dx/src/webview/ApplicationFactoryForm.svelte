<script lang="ts">
    import { untrack } from 'svelte';
    import BindingSObjectField from './BindingSObjectField.svelte';
    import { developerNameValid, ruleTitle } from './lib/bindingView';
    import { applicationFactoryDrawerCopy } from './lib/bindingDrawerCopy';
    import { activeFieldSetInclusionsForSObject, fieldSetCountLabel, suggestFieldSetInclusionDeveloperName } from './lib/fieldSetInclusionView';
    import type {
        ApplicationFactoryFormInitial,
        ApplicationFactoryFormPayload,
        ApplicationFactoryRules,
        At4dxBindingRow,
        BindingIssue,
        DomainProcessBindingRow,
        FieldSetInclusionIssue,
        FieldSetInclusionFormPayload,
        RawFieldSetInclusionRecord,
        WritableBindingType,
    } from './types';
    import { postMessage } from './vscodeApi';

    let {
        mode: modeProp,
        initial: initialProp,
        rules,
        standardObjects,
        allRows,
        domainProcessRows,
        fieldSetInclusions,
        onCancel,
    }: {
        mode: 'create' | 'edit';
        initial: ApplicationFactoryFormInitial;
        rules: ApplicationFactoryRules;
        standardObjects: string[];
        /** Every other Application Factory row already in the scan — powers the drawer's RESULTING BINDING preview (priority competition, commit position). See docs/design/0017. */
        allRows: At4dxBindingRow[];
        /** The Domain Process explorer's own rows, for the Domain drawer's "N process bindings resolve through it" sentence — `undefined` while that (separately-scanned) explorer hasn't resolved yet. */
        domainProcessRows: DomainProcessBindingRow[] | undefined;
        /** `SelectorConfig_FieldSetInclusion__mdt` records — Selector's own section 3 (Stage 4). See docs/design/0017. */
        fieldSetInclusions: RawFieldSetInclusionRecord[];
        onCancel: () => void;
    } = $props();

    // Same "read once" reasoning as `BindingForm.svelte` — a fresh instance is mounted per open, never
    // handed updated props in place. See that component's own comment for the full explanation.
    const mode = untrack(() => modeProp);
    const initial = untrack(() => initialProp);
    const isEdit = mode === 'edit';
    // Whether this create opened with the SObject/interface already fixed (a card's own "Add" link —
    // canvas 2b/2c) rather than free-typed (the sheet/tab-level toolbar button — canvas 2a/5b). Fixed at
    // open time, same as `mode`/`initial` — which entry point this is doesn't change as the user types.
    const prefilledFromGap = untrack(() => Boolean(initial.sobject) || Boolean(initial.bindingInterface));

    let bindingType = $state<WritableBindingType>(initial.bindingType ?? 'Service');
    let developerName = $state(initial.developerName ?? '');
    let label = $state(initial.label ?? '');
    let to = $state(initial.to ?? '');
    let bindingInterface = $state(initial.bindingInterface ?? '');
    let sobject = $state(initial.sobject ?? '');
    let sobjectAlternate = $state(Boolean(initial.sobjectAlternate));
    let priority = $state(initial.priority === undefined ? '' : String(initial.priority));
    let sequence = $state(initial.sequence === undefined ? '' : String(initial.sequence));

    let showPriority = $derived(bindingType === 'Service' || bindingType === 'Selector');
    let showTo = $derived(bindingType !== 'UnitOfWork');
    let key = $derived(bindingType === 'Service' ? bindingInterface : sobject);
    let priorityValue = $derived(priority.trim() === '' ? undefined : Number(priority.trim()));
    let sequenceValue = $derived(sequence.trim() === '' ? undefined : Number(sequence.trim()));
    let domainProcessBindingCount = $derived(domainProcessRows ? domainProcessRows.filter((row) => row.sobject === sobject.trim()).length : undefined);
    let copy = $derived(
        applicationFactoryDrawerCopy({
            mode,
            bindingType,
            developerName: isEdit ? initial.developerName : developerName,
            key,
            to,
            priority: priorityValue,
            sequence: sequenceValue,
            allRows,
            domainProcessBindingCount,
            prefilledFromGap,
        }),
    );

    let fieldErrors = $state<Record<string, string>>({});
    let formError = $state<string | undefined>(undefined);
    let blockedIssues = $state<BindingIssue[] | undefined>(undefined);
    let pendingForce = $state(false);
    let saving = $state(false);

    // Field set inclusions (Selector only, Stage 4) — a *local* copy, seeded once and updated in place by
    // `fieldSetInclusionsUpdated` below, never by a prop change (this drawer is never handed updated
    // props in place — see the "read once" comment above). Kept separate from the main binding's own
    // save/blocked/error state: adding or removing a field set is its own independent write (see canvas
    // 2a's own "queues a second write; the selector is created either way"), not part of the main
    // Create/Save action, so it never touches `saving`/`blockedIssues`/`formError`.
    let localFieldSetInclusions = $state(untrack(() => fieldSetInclusions));
    let activeInclusions = $derived(activeFieldSetInclusionsForSObject(localFieldSetInclusions, sobject));
    let newFieldsetName = $state('');
    let addingFieldSet = $state(false);
    let removingDeveloperName = $state<string | undefined>(undefined);
    let fieldSetError = $state<string | undefined>(undefined);
    let fieldSetBlockedIssues = $state<FieldSetInclusionIssue[] | undefined>(undefined);

    $effect(() => {
        function onMessage(event: MessageEvent): void {
            const message = event.data as {
                command?: string;
                issues?: BindingIssue[] | FieldSetInclusionIssue[];
                message?: string;
                records?: RawFieldSetInclusionRecord[];
            };
            if (message.command === 'writeBlocked') {
                saving = false;
                pendingForce = true;
                blockedIssues = (message.issues as BindingIssue[]) ?? [];
            } else if (message.command === 'writeError') {
                saving = false;
                formError = message.message ?? '';
            } else if (message.command === 'fieldSetInclusionsUpdated') {
                addingFieldSet = false;
                removingDeveloperName = undefined;
                fieldSetError = undefined;
                fieldSetBlockedIssues = undefined;
                newFieldsetName = '';
                localFieldSetInclusions = message.records ?? [];
            } else if (message.command === 'fieldSetInclusionBlocked') {
                addingFieldSet = false;
                removingDeveloperName = undefined;
                fieldSetBlockedIssues = (message.issues as FieldSetInclusionIssue[]) ?? [];
            } else if (message.command === 'fieldSetInclusionError') {
                addingFieldSet = false;
                removingDeveloperName = undefined;
                fieldSetError = message.message ?? '';
            }
        }
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    });

    function addFieldSet(): void {
        const trimmedFieldsetName = newFieldsetName.trim();
        const trimmedSobject = sobject.trim();
        if (!trimmedFieldsetName || !trimmedSobject) {
            return;
        }
        fieldSetError = undefined;
        fieldSetBlockedIssues = undefined;
        addingFieldSet = true;
        const existingNames = new Set(localFieldSetInclusions.map((record) => record.developerName));
        const payload: FieldSetInclusionFormPayload = {
            developerName: suggestFieldSetInclusionDeveloperName(trimmedSobject, trimmedFieldsetName, existingNames),
            sobject: trimmedSobject,
            sobjectAlternate,
            fieldsetName: trimmedFieldsetName,
        };
        postMessage({ command: 'submitFieldSetInclusion', mode: 'create', input: payload });
    }

    function removeFieldSet(developerName: string): void {
        fieldSetError = undefined;
        fieldSetBlockedIssues = undefined;
        removingDeveloperName = developerName;
        const payload: FieldSetInclusionFormPayload = { developerName, isActive: false };
        postMessage({ command: 'submitFieldSetInclusion', mode: 'update', input: payload });
    }

    function fieldError(id: string): string | undefined {
        return fieldErrors[id];
    }

    function onBreadcrumbKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onCancel();
        }
    }

    function save(): void {
        formError = undefined;
        blockedIssues = undefined;
        const errors: Record<string, string> = {};

        const trimmedDeveloperName = isEdit ? (initial.developerName ?? '') : developerName.trim();
        const trimmedLabel = label.trim();
        const trimmedTo = to.trim();
        const trimmedBindingInterface = bindingInterface.trim();
        const trimmedSobject = sobject.trim();
        const trimmedPriority = priority.trim();
        const trimmedSequence = sequence.trim();

        if (!isEdit && !developerNameValid(trimmedDeveloperName)) {
            errors.fDeveloperName =
                'Must start with a letter, contain only letters/numbers/single underscores, not end with an underscore, and be 40 characters or fewer.';
        }
        if (trimmedLabel.length > 40) {
            errors.fLabel = 'Must be 40 characters or fewer.';
        }
        if (showTo && !trimmedTo) {
            errors.fTo = 'Required.';
        }
        if (bindingType === 'Service' && !trimmedBindingInterface) {
            errors.fBindingInterface = 'Required.';
        }
        if (bindingType !== 'Service' && !trimmedSobject) {
            errors.fSobject = 'Required.';
        }
        if (trimmedPriority !== '' && Number.isNaN(priorityValue)) {
            errors.fPriority = 'Must be numeric.';
        }
        if (trimmedSequence !== '' && Number.isNaN(sequenceValue)) {
            errors.fSequence = 'Must be numeric.';
        }

        fieldErrors = errors;
        if (Object.keys(errors).length > 0) {
            return;
        }

        // Built as a per-type whitelist, not by sending every field state happens to hold — a stale
        // `priority` left over from switching the segmented control is exactly how a `type-field-mismatch`
        // reaches the host. See docs/design/0016.
        const payload: ApplicationFactoryFormPayload =
            bindingType === 'Service'
                ? { bindingType, developerName: trimmedDeveloperName, label: trimmedLabel, to: trimmedTo, bindingInterface: trimmedBindingInterface, priority: priorityValue }
                : bindingType === 'Selector'
                  ? { bindingType, developerName: trimmedDeveloperName, label: trimmedLabel, to: trimmedTo, sobject: trimmedSobject, sobjectAlternate, priority: priorityValue }
                  : bindingType === 'Domain'
                    ? { bindingType, developerName: trimmedDeveloperName, label: trimmedLabel, to: trimmedTo, sobject: trimmedSobject, sobjectAlternate }
                    : { bindingType, developerName: trimmedDeveloperName, label: trimmedLabel, sobject: trimmedSobject, sobjectAlternate, sequence: sequenceValue };

        saving = true;
        postMessage({ command: 'submitApplicationFactoryBinding', mode, input: payload, force: pendingForce });
    }
</script>

<div class="form-context-bar">
    <span class="form-title">{copy.title}</span>
    {#if key.trim()}<span class="form-context-devname">{key.trim()}</span>{/if}
    <span class="form-context-spacer"></span>
    {#if isEdit}
        <button class="secondary" disabled={saving} onclick={onCancel}>Discard</button>
        <button disabled={saving} onclick={save}>{pendingForce ? 'Save Anyway' : 'Save changes'}</button>
    {:else}
        <button class="secondary" disabled={saving} onclick={onCancel}>Cancel</button>
        <button disabled={saving} onclick={save}>{pendingForce ? 'Save Anyway' : 'Create binding'}</button>
    {/if}
</div>
<div class="form-breadcrumb-bar">
    {#if copy.breadcrumbLead}
        {#if isEdit}
            <span class="form-breadcrumb-current">{copy.breadcrumbLead}</span>
        {:else}
            <span class="form-breadcrumb-link" role="button" tabindex="0" onclick={onCancel} onkeydown={onBreadcrumbKeydown}>{copy.breadcrumbLead}</span>
        {/if}
        <span class="form-breadcrumb-sep">›</span>
    {/if}
    <span class="af-type-pill {copy.typePillClass}" class:af-type-pill-dashed={!isEdit}>{copy.typePillLabel}</span>
    <span class="form-breadcrumb-suffix">{copy.breadcrumbSuffix}</span>
</div>

{#if formError}
    <div class="form-error">{#each formError.split('\n') as line, i (i)}{#if i > 0}<br />{/if}{line}{/each}</div>
{/if}

{#if blockedIssues}
    <div class="section issues form-issues">
        <div class="section-header"><span class="section-title">This would introduce a wiring problem</span></div>
        {#each blockedIssues as issue, i (i)}
            <div class="issue" class:error={issue.severity === 'error'} class:warning={issue.severity !== 'error'}>
                <span class="issue-icon" class:error={issue.severity === 'error'} class:warning={issue.severity !== 'error'}>⚠</span>
                <span class="issue-title">{ruleTitle(rules, issue.rule)}</span>
                {#if issue.developerName}
                    <span class="issue-meta">{issue.developerName}</span>
                {/if}
                <span class="issue-message">{issue.message}</span>
            </div>
        {/each}
    </div>
{/if}

<div class="form-preview">
    <span class="form-preview-eyebrow">RESULTING BINDING</span>
    <span class="form-preview-text"
        >{#each copy.resultingBinding as segment, i (i)}{#if segment.emphasis === 'bold'}<strong>{segment.text}</strong>{:else if segment.emphasis === 'mono'}<span
                    class="mono-link">{segment.text}</span
                >{:else}{segment.text}{/if}{/each}</span
    >
    {#if copy.cliPreview}
        <span class="form-cli-preview">{copy.cliPreview}</span>
    {/if}
</div>

<div class="form-sections">
    <div class="form-section">
        <div class="form-section-header">
            <span class="form-section-badge">1</span>
            <span class="form-section-title">Identity</span>
        </div>
        <div class="form-grid">
            <div class="form-field">
                <label for="fBindingType">Binding Type</label>
                <div class="segmented" id="fBindingType" role="group" aria-label="Binding Type">
                    <button type="button" class="segmented-option" class:selected={bindingType === 'Service'} disabled={isEdit} onclick={() => (bindingType = 'Service')}>
                        Service
                    </button>
                    <button type="button" class="segmented-option" class:selected={bindingType === 'Selector'} disabled={isEdit} onclick={() => (bindingType = 'Selector')}>
                        Selector
                    </button>
                    <button type="button" class="segmented-option" class:selected={bindingType === 'Domain'} disabled={isEdit} onclick={() => (bindingType = 'Domain')}>
                        Domain
                    </button>
                    <button type="button" class="segmented-option" class:selected={bindingType === 'UnitOfWork'} disabled={isEdit} onclick={() => (bindingType = 'UnitOfWork')}>
                        Unit of Work
                    </button>
                </div>
            </div>

            <div class="form-field">
                <label for="fDeveloperName">Developer Name <span class="required-marker">*</span></label>
                {#if isEdit}
                    <input type="text" id="fDeveloperName" value={initial.developerName} disabled />
                {:else}
                    <input
                        type="text"
                        id="fDeveloperName"
                        class:field-invalid={fieldError('fDeveloperName')}
                        bind:value={developerName}
                        placeholder="AccountsSelectorBinding"
                    />
                {/if}
                <span class="form-field-error">{fieldError('fDeveloperName') ?? ''}</span>
            </div>

            <div class="form-field">
                <label for="fLabel">Label <span class="form-hint">Defaults to Developer Name</span></label>
                <input type="text" id="fLabel" class:field-invalid={fieldError('fLabel')} bind:value={label} placeholder={initial.developerName ?? ''} />
                <span class="form-field-error">{fieldError('fLabel') ?? ''}</span>
            </div>
        </div>
    </div>

    <div class="form-section">
        <div class="form-section-header">
            <span class="form-section-badge">2</span>
            <span class="form-section-title">Binding</span>
        </div>
        <div class="form-grid">
            {#if bindingType === 'Service'}
                <div class="form-field">
                    <label for="fBindingInterface">Interface <span class="required-marker">*</span></label>
                    <input type="text" id="fBindingInterface" class:field-invalid={fieldError('fBindingInterface')} bind:value={bindingInterface} placeholder="IPricingService" />
                    <span class="form-field-error">{fieldError('fBindingInterface') ?? ''}</span>
                </div>
            {:else}
                <BindingSObjectField id="fSobject" bind:value={sobject} bind:alternate={sobjectAlternate} {standardObjects} error={fieldError('fSobject')} />
            {/if}

            {#if showTo}
                <div class="form-field">
                    <label for="fTo">Implementation <span class="required-marker">*</span></label>
                    <input type="text" id="fTo" class:field-invalid={fieldError('fTo')} bind:value={to} placeholder="AccountsSelector" />
                    <span class="form-field-error">{fieldError('fTo') ?? ''}</span>
                </div>
            {/if}

            {#if showPriority}
                <div class="form-field">
                    <label for="fPriority">Priority <span class="form-hint">optional — higher wins a tie</span></label>
                    <input
                        type="number"
                        id="fPriority"
                        step="1"
                        class:field-invalid={fieldError('fPriority')}
                        value={priority}
                        oninput={(event) => (priority = (event.currentTarget as HTMLInputElement).value)}
                    />
                    <span class="form-field-error">{fieldError('fPriority') ?? ''}</span>
                </div>
            {/if}

            {#if bindingType === 'UnitOfWork'}
                <div class="form-field">
                    <label for="fSequence">Commit Sequence <span class="form-hint">optional — lower commits first</span></label>
                    <input
                        type="number"
                        id="fSequence"
                        step="1"
                        class:field-invalid={fieldError('fSequence')}
                        value={sequence}
                        oninput={(event) => (sequence = (event.currentTarget as HTMLInputElement).value)}
                    />
                    <span class="form-field-error">{fieldError('fSequence') ?? ''}</span>
                </div>
            {/if}
        </div>
    </div>

    {#if bindingType === 'Selector'}
        <div class="form-section">
            <div class="form-section-header">
                <span class="form-section-badge">3</span>
                <span class="form-section-title">Field set inclusions</span>
                <span class="form-hint">optional</span>
            </div>
            <div class="fsi-body">
                {#if fieldSetBlockedIssues}
                    <div class="section issues form-issues">
                        <div class="section-header"><span class="section-title">This would introduce a wiring problem</span></div>
                        {#each fieldSetBlockedIssues as issue, i (i)}
                            <div class="issue" class:error={issue.severity === 'error'} class:warning={issue.severity !== 'error'}>
                                <span class="issue-icon" class:error={issue.severity === 'error'} class:warning={issue.severity !== 'error'}>⚠</span>
                                <span class="issue-title">{issue.rule}</span>
                                <span class="issue-message">{issue.message}</span>
                            </div>
                        {/each}
                    </div>
                {/if}
                {#if fieldSetError}
                    <div class="form-error">{fieldSetError}</div>
                {/if}
                {#if activeInclusions.length === 0}
                    <p class="empty fsi-empty">{fieldSetCountLabel(0)} — queries against {sobject.trim() || 'this SObject'} return every field.</p>
                {:else}
                    <ul class="fsi-list">
                        {#each activeInclusions as inclusion (inclusion.developerName)}
                            <li class="fsi-row">
                                <span class="fsi-name">{inclusion.fieldsetName}</span>
                                <span class="fsi-source">{inclusion.source}</span>
                                <button
                                    type="button"
                                    class="fsi-remove"
                                    disabled={removingDeveloperName === inclusion.developerName}
                                    title="Remove {inclusion.fieldsetName}"
                                    aria-label="Remove {inclusion.fieldsetName}"
                                    onclick={() => removeFieldSet(inclusion.developerName)}>✕</button
                                >
                            </li>
                        {/each}
                    </ul>
                {/if}
                <div class="fsi-add-row">
                    <input
                        type="text"
                        aria-label="Field set API name"
                        placeholder="Add a field set on {sobject.trim() || 'this SObject'}"
                        bind:value={newFieldsetName}
                        disabled={addingFieldSet || !sobject.trim()}
                    />
                    <button type="button" class="secondary" disabled={addingFieldSet || !newFieldsetName.trim() || !sobject.trim()} onclick={addFieldSet}>
                        {addingFieldSet ? 'Adding…' : 'Add'}
                    </button>
                </div>
                <span class="form-hint fsi-note">Inclusions are their own records and their own command, so they save independently of the binding above.</span>
            </div>
        </div>
    {/if}
</div>
