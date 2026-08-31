<script lang="ts">
    import { untrack } from 'svelte';
    import BindingSObjectField from './BindingSObjectField.svelte';
    import { developerNameValid, ruleTitle } from './lib/bindingView';
    import { previewCommitPosition } from './lib/applicationFactoryView';
    import type { ApplicationFactoryFormInitial, ApplicationFactoryFormPayload, ApplicationFactoryRules, At4dxBindingRow, BindingIssue, WritableBindingType } from './types';
    import { postMessage } from './vscodeApi';

    let {
        mode: modeProp,
        initial: initialProp,
        rules,
        standardObjects,
        existingUnitOfWorkRows,
        onCancel,
    }: {
        mode: 'create' | 'edit';
        initial: ApplicationFactoryFormInitial;
        rules: ApplicationFactoryRules;
        standardObjects: string[];
        /** Every other UnitOfWork row already in the scan — powers the "commits Nth of M" live preview. See docs/design/0016. */
        existingUnitOfWorkRows: At4dxBindingRow[];
        onCancel: () => void;
    } = $props();

    // Same "read once" reasoning as `BindingForm.svelte` — a fresh instance is mounted per open, never
    // handed updated props in place. See that component's own comment for the full explanation.
    const mode = untrack(() => modeProp);
    const initial = untrack(() => initialProp);
    const isEdit = mode === 'edit';

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
    let commitPreview = $derived(
        bindingType === 'UnitOfWork'
            ? previewCommitPosition(existingUnitOfWorkRows, isEdit ? initial.developerName : undefined, sequence.trim() === '' ? undefined : Number(sequence.trim()))
            : undefined,
    );

    let fieldErrors = $state<Record<string, string>>({});
    let formError = $state<string | undefined>(undefined);
    let blockedIssues = $state<BindingIssue[] | undefined>(undefined);
    let pendingForce = $state(false);
    let saving = $state(false);

    $effect(() => {
        function onMessage(event: MessageEvent): void {
            const message = event.data as { command?: string; issues?: BindingIssue[]; message?: string };
            if (message.command === 'writeBlocked') {
                saving = false;
                pendingForce = true;
                blockedIssues = message.issues ?? [];
            } else if (message.command === 'writeError') {
                saving = false;
                formError = message.message ?? '';
            }
        }
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    });

    function fieldError(id: string): string | undefined {
        return fieldErrors[id];
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
        const priorityValue = trimmedPriority === '' ? undefined : Number(trimmedPriority);
        const trimmedSequence = sequence.trim();
        const sequenceValue = trimmedSequence === '' ? undefined : Number(trimmedSequence);

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

{#if isEdit}
    <div class="form-context-bar">
        <span>Editing</span>
        <span class="form-context-devname">{initial.developerName}</span>
        <span class="form-context-spacer"></span>
        <button class="secondary" disabled={saving} onclick={onCancel}>Discard</button>
        <button disabled={saving} onclick={save}>{pendingForce ? 'Save Anyway' : 'Save changes'}</button>
    </div>
{:else}
    <div class="form-context-bar">
        <span class="form-breadcrumb-current">New Application Factory binding</span>
        <span class="form-context-spacer"></span>
        <button class="secondary" disabled={saving} onclick={onCancel}>Cancel</button>
        <button disabled={saving} onclick={save}>{pendingForce ? 'Save Anyway' : 'Create binding'}</button>
    </div>
{/if}

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
    <span class="form-preview-text">
        {#if bindingType === 'Service'}
            <span class="mono-link">{bindingInterface.trim() || '…'}</span> resolves to
            <span class="mono-link">{to.trim() || '…'}</span>{#if showPriority}, at priority <span class="mono-link">{priority.trim() || '—'}</span>{/if}.
        {:else if bindingType === 'Selector'}
            Queries against <strong>{sobject.trim() || 'SObject'}</strong> use <span class="mono-link">{to.trim() || '…'}</span>, at priority
            <span class="mono-link">{priority.trim() || '—'}</span>.
        {:else if bindingType === 'Domain'}
            <strong>{sobject.trim() || 'SObject'}</strong> domain logic runs through <span class="mono-link">{to.trim() || '…'}</span>.
        {:else if commitPreview}
            <strong>{sobject.trim() || 'SObject'}</strong> joins the shared Unit of Work and commits
            <span class="mono-link">{commitPreview.label}</span> of {commitPreview.total}.
        {/if}
    </span>
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
</div>
