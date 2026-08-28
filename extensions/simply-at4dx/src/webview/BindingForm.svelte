<script lang="ts">
    import { untrack } from 'svelte';
    import { TRIGGER_OPERATIONS, TRIGGER_OPERATION_LABELS, developerNameValid, ruleTitle } from './lib/bindingView';
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
        onCancel,
    }: {
        mode: 'create' | 'edit';
        initial: BindingFormInitial;
        rules: DomainProcessBindingRules;
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

<div class="form-title">{isEdit ? 'Edit Binding' : 'New Binding'}</div>

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

<div class="form-grid">
    <div class="form-field">
        <label for="fDeveloperName">Developer Name</label>
        {#if isEdit}
            <input type="text" id="fDeveloperName" value={initial.developerName} disabled />
        {:else}
            <input type="text" id="fDeveloperName" bind:value={developerName} placeholder="Account_Before_Insert_Assign_Owner" />
        {/if}
        <span class="form-field-error" id="fDeveloperNameError">{fieldError('fDeveloperName') ?? ''}</span>
    </div>

    <div class="form-field">
        <label for="fLabel">Label <span class="form-hint">Defaults to Developer Name</span></label>
        <input type="text" id="fLabel" bind:value={label} placeholder={initial.developerName ?? ''} />
        <span class="form-field-error" id="fLabelError">{fieldError('fLabel') ?? ''}</span>
    </div>

    <div class="form-field">
        <label for="fSobject">SObject</label>
        <input type="text" id="fSobject" bind:value={sobject} />
        <span class="form-field-error" id="fSobjectError">{fieldError('fSobject') ?? ''}</span>
    </div>

    <div class="form-field">
        <label for="fSobjectAlternateInput"></label>
        <label class="form-checkbox">
            <input type="checkbox" id="fSobjectAlternateInput" bind:checked={sobjectAlternate} /> Bind via alternate field
        </label>
        <span class="form-hint">For Setup objects like ServiceResource</span>
        <span class="form-field-error"></span>
    </div>

    <div class="form-field">
        <label for="fProcessContext">Process Context</label>
        <select id="fProcessContext" bind:value={processContext}>
            <option value="TriggerExecution">Trigger Execution</option>
            <option value="DomainMethodExecution">Domain Method Execution</option>
        </select>
    </div>

    <div class="form-field">
        <label for="fType">Type</label>
        <select id="fType" bind:value={type}>
            <option value="Action">Action</option>
            <option value="Criteria">Criteria</option>
        </select>
    </div>

    {#if isTrigger}
        <div class="form-field">
            <label for="fTriggerOperation">Trigger Operation</label>
            <select id="fTriggerOperation" bind:value={triggerOperation}>
                <option value="">&mdash; Select &mdash;</option>
                {#each TRIGGER_OPERATIONS as op (op)}
                    <option value={op}>{TRIGGER_OPERATION_LABELS[op]}</option>
                {/each}
            </select>
            <span class="form-field-error" id="fTriggerOperationError">{fieldError('fTriggerOperation') ?? ''}</span>
        </div>
    {:else}
        <div class="form-field">
            <label for="fDomainMethodToken">Domain Method Token</label>
            <input type="text" id="fDomainMethodToken" bind:value={domainMethodToken} />
            <span class="form-field-error" id="fDomainMethodTokenError">{fieldError('fDomainMethodToken') ?? ''}</span>
        </div>
    {/if}

    <div class="form-field">
        <label for="fClassToInject">Class to Inject</label>
        <input type="text" id="fClassToInject" bind:value={classToInject} />
        <span class="form-field-error" id="fClassToInjectError">{fieldError('fClassToInject') ?? ''}</span>
    </div>

    <div class="form-field">
        <label for="fOrder">Order</label>
        <input
            type="number"
            id="fOrder"
            step="any"
            value={order}
            oninput={(event) => (order = (event.currentTarget as HTMLInputElement).value)}
        />
        <span class="form-field-error" id="fOrderError">{fieldError('fOrder') ?? ''}</span>
    </div>

    <div class="form-field span2">
        <label for="fFlags"></label>
        <div style="display:flex; gap:16px; flex-wrap:wrap;">
            <label class="form-checkbox"><input type="checkbox" bind:checked={isActive} /> Active</label>
            <label class="form-checkbox"><input type="checkbox" bind:checked={executeAsynchronous} /> Execute Asynchronously</label>
            <label class="form-checkbox"><input type="checkbox" bind:checked={logicalInverse} /> Logical Inverse</label>
            <label class="form-checkbox"><input type="checkbox" bind:checked={preventRecursive} /> Prevent Recursive</label>
        </div>
    </div>

    <div class="form-field span2">
        <label for="fDescription">Description</label>
        <textarea id="fDescription" bind:value={description}></textarea>
    </div>
</div>

<div class="form-actions">
    <button disabled={saving} onclick={save}>{pendingForce ? 'Save Anyway' : 'Save'}</button>
    <button class="secondary" onclick={onCancel}>Cancel</button>
</div>
