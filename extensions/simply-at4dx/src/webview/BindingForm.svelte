<script lang="ts">
    import { untrack } from 'svelte';
    import { TRIGGER_OPERATIONS, TRIGGER_OPERATION_LABELS, developerNameValid, familyVerbForOperation, ruleTitle } from './lib/bindingView';
    import type {
        BindingFormInitial,
        BindingFormPayload,
        DomainProcessBindingIssue,
        DomainProcessBindingRules,
        DomainProcessType,
        ProcessContext,
        TriggerOperation,
    } from './types';
    import { postMessage } from './vscodeApi';

    let {
        mode: modeProp,
        initial: initialProp,
        rules,
        scopeSobject,
        scopeLabel,
        onCancel,
    }: {
        mode: 'create' | 'edit';
        initial: BindingFormInitial;
        rules: DomainProcessBindingRules;
        scopeSobject: string;
        scopeLabel: string;
        onCancel: () => void;
    } = $props();

    // `mode`/`initial` seed this form's local editable state once and are never read again after
    // that — the caller mounts a fresh `BindingForm` per open (`App.svelte`'s `view = 'form'`), it
    // never receives updated props in place. `untrack` makes that "read once" intent explicit instead
    // of a suppressed `state_referenced_locally` warning.
    const mode = untrack(() => modeProp);
    const initial = untrack(() => initialProp);

    const isEdit = mode === 'edit';

    let developerName = $state(initial.developerName ?? '');
    let label = $state(initial.label ?? '');
    let sobject = $state(initial.sobject ?? '');
    let sobjectAlternate = $state(initial.sobjectField === 'alternate');
    let processContext = $state<ProcessContext>(initial.processContext ?? 'TriggerExecution');
    let type = $state<DomainProcessType>(initial.type ?? 'Action');
    let triggerOperation = $state<TriggerOperation | ''>(initial.triggerOperation ?? '');
    let domainMethodToken = $state(initial.domainMethodToken ?? '');
    let classToInject = $state(initial.classToInject ?? '');
    let order = $state(initial.order === undefined || initial.order === null ? '' : String(initial.order));
    let isActive = $state(initial.isActive !== false);
    let executeAsynchronous = $state(Boolean(initial.executeAsynchronous));
    let logicalInverse = $state(Boolean(initial.logicalInverse));
    let preventRecursive = $state(Boolean(initial.preventRecursive));
    let description = $state(initial.description ?? '');

    let isTrigger = $derived(processContext !== 'DomainMethodExecution');

    let previewArticle = $derived(/^[aeiou]/i.test(sobject.trim()) ? 'an' : 'a');
    let previewSobject = $derived(sobject.trim() || 'SObject');
    let previewProcessLabel = $derived(processContext === 'DomainMethodExecution' ? 'Domain Method Execution' : 'Trigger Execution');

    let fieldErrors = $state<Record<string, string>>({});
    let formError = $state<string | undefined>(undefined);
    let blockedIssues = $state<DomainProcessBindingIssue[] | undefined>(undefined);
    let pendingForce = $state(false);
    let saving = $state(false);

    $effect(() => {
        function onMessage(event: MessageEvent): void {
            const message = event.data as { command?: string; issues?: DomainProcessBindingIssue[]; message?: string };
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
        const trimmedSobject = sobject.trim();
        const trimmedClassToInject = classToInject.trim();
        const trimmedOrder = order.trim();
        const orderValue = Number(trimmedOrder);
        const trimmedDomainMethodToken = domainMethodToken.trim();

        if (!isEdit && !developerNameValid(trimmedDeveloperName)) {
            errors.fDeveloperName =
                'Must start with a letter, contain only letters/numbers/single underscores, not end with an underscore, and be 40 characters or fewer.';
        }
        if (trimmedLabel.length > 40) {
            errors.fLabel = 'Must be 40 characters or fewer.';
        }
        if (!trimmedSobject) {
            errors.fSobject = 'Required.';
        }
        if (!trimmedClassToInject) {
            errors.fClassToInject = 'Required.';
        }
        if (trimmedOrder === '' || Number.isNaN(orderValue)) {
            errors.fOrder = 'Required, numeric.';
        }
        if (isTrigger && !triggerOperation) {
            errors.fTriggerOperation = 'Required.';
        }
        if (!isTrigger && !trimmedDomainMethodToken) {
            errors.fDomainMethodToken = 'Required.';
        }

        fieldErrors = errors;
        if (Object.keys(errors).length > 0) {
            return;
        }

        const payload: BindingFormPayload = {
            developerName: trimmedDeveloperName,
            label: trimmedLabel,
            sobject: trimmedSobject,
            sobjectAlternate,
            processContext,
            triggerOperation: isTrigger ? (triggerOperation as TriggerOperation) : undefined,
            domainMethodToken: isTrigger ? undefined : trimmedDomainMethodToken,
            type,
            classToInject: trimmedClassToInject,
            order: orderValue,
            isActive,
            executeAsynchronous,
            logicalInverse,
            preventRecursive,
            description: description.trim(),
        };

        saving = true;
        postMessage({ command: 'submitBinding', mode, input: payload, force: pendingForce });
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
        <span class="form-breadcrumb-link" role="button" tabindex="0" onclick={onCancel} onkeydown={onBreadcrumbKeydown}>{scopeSobject} / {scopeLabel}</span>
        <span class="form-breadcrumb-sep">›</span>
        <span class="form-breadcrumb-current">New binding</span>
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

{#if !isEdit}
    <div class="form-scope-strip">
        <span class="form-scope-label">Scope locked while creating:</span>
        <span class="pill">{scopeSobject}</span>
        <span class="pill">{scopeLabel}</span>
    </div>
{/if}

<div class="form-preview">
    <span class="form-preview-eyebrow">RESULTING BINDING</span>
    <span class="form-preview-text">
        When {previewArticle} <strong>{previewSobject}</strong>
        {#if isTrigger}
            is <strong>{triggerOperation ? familyVerbForOperation(triggerOperation) : '…'}</strong>,
        {:else}
            domain method <strong>{domainMethodToken.trim() || '…'}</strong> executes,
        {/if}
        run the <strong>{type}</strong>
        <span class="mono-link">{classToInject.trim() || '…'}</span>
        at order <span class="mono-link">{order.trim() || '…'}</span>
        during <strong>{previewProcessLabel}</strong>.
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
                <label for="fDeveloperName">Developer Name <span class="required-marker">*</span></label>
                {#if isEdit}
                    <input type="text" id="fDeveloperName" value={initial.developerName} disabled />
                {:else}
                    <input
                        type="text"
                        id="fDeveloperName"
                        class:field-invalid={fieldError('fDeveloperName')}
                        bind:value={developerName}
                        placeholder="Account_Before_Insert_Assign_Owner"
                    />
                {/if}
                <span class="form-field-error" id="fDeveloperNameError">{fieldError('fDeveloperName') ?? ''}</span>
            </div>

            <div class="form-field">
                <label for="fLabel">Label <span class="form-hint">Defaults to Developer Name</span></label>
                <input type="text" id="fLabel" class:field-invalid={fieldError('fLabel')} bind:value={label} placeholder={initial.developerName ?? ''} />
                <span class="form-field-error" id="fLabelError">{fieldError('fLabel') ?? ''}</span>
            </div>
        </div>
    </div>

    <div class="form-section">
        <div class="form-section-header">
            <span class="form-section-badge">2</span>
            <span class="form-section-title">When it runs</span>
        </div>
        <div class="form-grid">
            <div class="form-field">
                <label for="fSobject">SObject <span class="required-marker">*</span></label>
                <input type="text" id="fSobject" class:field-invalid={fieldError('fSobject')} bind:value={sobject} />
                <span class="form-hint">Prefilled from the current scope</span>
                <span class="form-field-error" id="fSobjectError">{fieldError('fSobject') ?? ''}</span>
            </div>

            <div class="form-field">
                <label for="fProcessContext">Process Context</label>
                <select id="fProcessContext" bind:value={processContext}>
                    <option value="TriggerExecution">Trigger Execution</option>
                    <option value="DomainMethodExecution">Domain Method Execution</option>
                </select>
            </div>

            {#if isTrigger}
                <div class="form-field">
                    <label for="fTriggerOperation">Trigger Operation <span class="required-marker">*</span></label>
                    <select id="fTriggerOperation" class:field-invalid={fieldError('fTriggerOperation')} bind:value={triggerOperation}>
                        <option value="">&mdash; Select &mdash;</option>
                        {#each TRIGGER_OPERATIONS as op (op)}
                            <option value={op}>{TRIGGER_OPERATION_LABELS[op]}</option>
                        {/each}
                    </select>
                    <span class="form-field-error" id="fTriggerOperationError">{fieldError('fTriggerOperation') ?? ''}</span>
                </div>
            {:else}
                <div class="form-field">
                    <label for="fDomainMethodToken">Domain Method Token <span class="required-marker">*</span></label>
                    <input type="text" id="fDomainMethodToken" class:field-invalid={fieldError('fDomainMethodToken')} bind:value={domainMethodToken} />
                    <span class="form-field-error" id="fDomainMethodTokenError">{fieldError('fDomainMethodToken') ?? ''}</span>
                </div>
            {/if}

            <div class="form-field">
                <label for="fOrder">Order <span class="required-marker">*</span></label>
                <input
                    type="number"
                    id="fOrder"
                    step="any"
                    class:field-invalid={fieldError('fOrder')}
                    value={order}
                    oninput={(event) => (order = (event.currentTarget as HTMLInputElement).value)}
                />
                <span class="form-field-error" id="fOrderError">{fieldError('fOrder') ?? ''}</span>
            </div>

            <div class="form-field">
                <div class="toggle-row">
                    <label class="toggle" for="fSobjectAlternateInput">
                        <input type="checkbox" id="fSobjectAlternateInput" class="toggle-input" bind:checked={sobjectAlternate} />
                        <span class="toggle-track"><span class="toggle-knob"></span></span>
                    </label>
                    <label class="toggle-label" for="fSobjectAlternateInput">Use Alternate SObject Binding</label>
                </div>
                <span class="form-hint">For Setup objects like ServiceResource</span>
                <span class="form-field-error"></span>
            </div>
        </div>
    </div>

    <div class="form-section">
        <div class="form-section-header">
            <span class="form-section-badge">3</span>
            <span class="form-section-title">What it does</span>
        </div>
        <div class="form-grid">
            <div class="form-field">
                <label for="fType">Type</label>
                <div class="segmented" id="fType" role="group" aria-label="Type">
                    <button type="button" class="segmented-option" class:selected={type === 'Action'} onclick={() => (type = 'Action')}>Action</button>
                    <button type="button" class="segmented-option" class:selected={type === 'Criteria'} onclick={() => (type = 'Criteria')}>Criteria</button>
                </div>
            </div>

            <div class="form-field">
                <label for="fClassToInject">Class to Inject <span class="required-marker">*</span></label>
                <input type="text" id="fClassToInject" class:field-invalid={fieldError('fClassToInject')} bind:value={classToInject} />
                <span class="form-field-error" id="fClassToInjectError">{fieldError('fClassToInject') ?? ''}</span>
            </div>

            <div class="form-field span2">
                <label for="fFlags">&nbsp;</label>
                <div style="display:flex; gap:16px; flex-wrap:wrap;">
                    <label class="form-checkbox"><input type="checkbox" bind:checked={isActive} /> Active</label>
                    <label class="form-checkbox"><input type="checkbox" bind:checked={executeAsynchronous} /> Execute asynchronously</label>
                    <label class="form-checkbox"><input type="checkbox" bind:checked={logicalInverse} /> Logical inverse</label>
                    <label class="form-checkbox"><input type="checkbox" bind:checked={preventRecursive} /> Prevent recursive</label>
                </div>
            </div>
        </div>
    </div>
</div>

<div class="form-field form-description">
    <label for="fDescription">Description <span class="form-hint">optional</span></label>
    <textarea id="fDescription" bind:value={description}></textarea>
</div>
