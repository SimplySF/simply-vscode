<script lang="ts">
    import { untrack } from 'svelte';
    import { developerNameValid, ruleTitle } from './lib/bindingView';
    import { ALL_MATCHER_RULES, MATCHER_RULE_LABEL, MATCHER_RULE_REQUIRED_FIELDS } from './lib/platformEventView';
    import type { MatcherRule, PlatformEventFormInitial, PlatformEventFormPayload, PlatformEventSubscriptionIssue, PlatformEventSubscriptionIssueRule, PlatformEventSubscriptionRuleInfo } from './types';
    import { postMessage } from './vscodeApi';

    let {
        mode: modeProp,
        initial: initialProp,
        rules,
        onCancel,
    }: {
        mode: 'create' | 'edit';
        initial: PlatformEventFormInitial;
        rules: Record<PlatformEventSubscriptionIssueRule, PlatformEventSubscriptionRuleInfo>;
        onCancel: () => void;
    } = $props();

    // Same "read once" reasoning as every other drawer in this panel — a fresh instance is mounted per
    // open, never handed updated props in place. See `ApplicationFactoryForm.svelte`'s own comment.
    const mode = untrack(() => modeProp);
    const initial = untrack(() => initialProp);
    const isEdit = mode === 'edit';

    let developerName = $state(initial.developerName ?? '');
    let label = $state(initial.label ?? '');
    let eventBus = $state(initial.eventBus ?? '');
    let matcherRule = $state<MatcherRule>(initial.matcherRule ?? 'MatchEventBusAndCategoryAndEventName');
    let eventCategory = $state(initial.eventCategory ?? '');
    let event = $state(initial.event ?? '');
    let consumer = $state(initial.consumer ?? '');
    let executeSynchronous = $state(Boolean(initial.executeSynchronous));

    let requiredFields = $derived(MATCHER_RULE_REQUIRED_FIELDS[matcherRule]);
    let categoryRequired = $derived(requiredFields.includes('eventCategory'));
    let eventRequired = $derived(requiredFields.includes('event'));
    let matcherHint = $derived(
        requiredFields.length === 0
            ? 'No match field is required — every event on this bus reaches the matcher.'
            : requiredFields.length === 2
              ? 'Both match fields below become required — the distributor compares them without a null check.'
              : `${categoryRequired ? 'Event Category' : 'Event'} below becomes required — the distributor compares it without a null check.`,
    );

    let fieldErrors = $state<Record<string, string>>({});
    let formError = $state<string | undefined>(undefined);
    let blockedIssues = $state<PlatformEventSubscriptionIssue[] | undefined>(undefined);
    let pendingForce = $state(false);
    let saving = $state(false);

    $effect(() => {
        function onMessage(event: MessageEvent): void {
            const message = event.data as { command?: string; issues?: PlatformEventSubscriptionIssue[]; message?: string };
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

    function onBreadcrumbKeydown(keyEvent: KeyboardEvent): void {
        if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
            keyEvent.preventDefault();
            onCancel();
        }
    }

    function save(): void {
        formError = undefined;
        blockedIssues = undefined;
        const errors: Record<string, string> = {};

        const trimmedDeveloperName = isEdit ? (initial.developerName ?? '') : developerName.trim();
        const trimmedLabel = label.trim();
        const trimmedEventBus = eventBus.trim();
        const trimmedCategory = eventCategory.trim();
        const trimmedEvent = event.trim();
        const trimmedConsumer = consumer.trim();

        if (!isEdit && !developerNameValid(trimmedDeveloperName)) {
            errors.fDeveloperName =
                'Must start with a letter, contain only letters/numbers/single underscores, not end with an underscore, and be 40 characters or fewer.';
        }
        if (trimmedLabel.length > 40) {
            errors.fLabel = 'Must be 40 characters or fewer.';
        }
        if (!trimmedEventBus) {
            errors.fEventBus = 'Required.';
        }
        if (!trimmedConsumer) {
            errors.fConsumer = 'Required.';
        }
        if (categoryRequired && !trimmedCategory) {
            errors.fEventCategory = 'Required — this matcher rule compares it without a null check.';
        }
        if (eventRequired && !trimmedEvent) {
            errors.fEvent = 'Required — this matcher rule compares it without a null check.';
        }

        fieldErrors = errors;
        if (Object.keys(errors).length > 0) {
            return;
        }

        const payload: PlatformEventFormPayload = {
            developerName: trimmedDeveloperName,
            label: trimmedLabel || undefined,
            eventBus: trimmedEventBus,
            consumer: trimmedConsumer,
            matcherRule,
            eventCategory: trimmedCategory || undefined,
            event: trimmedEvent || undefined,
            executeSynchronous,
        };

        saving = true;
        postMessage({ command: 'submitPlatformEvent', mode, input: payload, force: pendingForce });
    }
</script>

<div class="form-context-bar">
    <span class="form-title">{isEdit ? 'Edit platform event subscription' : 'New platform event subscription'}</span>
    {#if consumer.trim()}<span class="form-context-devname">{consumer.trim()}</span>{/if}
    <span class="form-context-spacer"></span>
    {#if isEdit}
        <button class="secondary" disabled={saving} onclick={onCancel}>Discard</button>
        <button disabled={saving} onclick={save}>{pendingForce ? 'Save Anyway' : 'Save changes'}</button>
    {:else}
        <button class="secondary" disabled={saving} onclick={onCancel}>Cancel</button>
        <button disabled={saving} onclick={save}>{pendingForce ? 'Save Anyway' : 'Create'}</button>
    {/if}
</div>
<div class="form-breadcrumb-bar">
    <span class="form-breadcrumb-link" role="button" tabindex="0" onclick={onCancel} onkeydown={onBreadcrumbKeydown}>SUBSCRIBER</span>
    <span class="form-breadcrumb-sep">›</span>
    <span class="pe-type-pill">{eventBus.trim() || '…'}</span>
    {#if eventCategory.trim()}
        <span class="form-breadcrumb-sep">›</span>
        <span class="form-breadcrumb-suffix">{eventCategory.trim()}</span>
    {/if}
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

<div class="form-sections">
    <div class="form-section">
        <div class="form-section-header">
            <span class="form-section-badge">1</span>
            <span class="form-section-title">Matching</span>
        </div>
        <div class="form-grid">
            <div class="form-field span2">
                <label for="fEventBus">Event Bus <span class="required-marker">*</span></label>
                <input type="text" id="fEventBus" class:field-invalid={fieldError('fEventBus')} bind:value={eventBus} placeholder="Sales_Event__e" />
                <span class="form-field-error">{fieldError('fEventBus') ?? ''}</span>
            </div>
            <div class="form-field span2">
                <label for="fMatcherRule">Matcher Rule</label>
                <select id="fMatcherRule" bind:value={matcherRule}>
                    {#each ALL_MATCHER_RULES as rule (rule)}
                        <option value={rule}>{MATCHER_RULE_LABEL[rule]}</option>
                    {/each}
                </select>
                <span class="form-hint">{matcherHint}</span>
            </div>
            <div class="form-field">
                <label for="fEventCategory">Event Category {#if categoryRequired}<span class="required-marker">*</span>{/if}</label>
                <input type="text" id="fEventCategory" class:field-invalid={fieldError('fEventCategory')} bind:value={eventCategory} placeholder="Account" />
                <span class="form-field-error">{fieldError('fEventCategory') ?? ''}</span>
            </div>
            <div class="form-field">
                <label for="fEvent">Event {#if eventRequired}<span class="required-marker">*</span>{/if}</label>
                <input type="text" id="fEvent" class:field-invalid={fieldError('fEvent')} bind:value={event} placeholder="e.g. TierChanged" />
                <span class="form-field-error">{fieldError('fEvent') ?? ''}</span>
            </div>
        </div>
    </div>

    <div class="form-section">
        <div class="form-section-header">
            <span class="form-section-badge">2</span>
            <span class="form-section-title">Consumer</span>
        </div>
        <div class="form-grid">
            <div class="form-field span2">
                <label for="fConsumer">Consumer class <span class="required-marker">*</span></label>
                <input type="text" id="fConsumer" class:field-invalid={fieldError('fConsumer')} bind:value={consumer} placeholder="AccountTierRecalcConsumer" />
                <span class="form-field-error">{fieldError('fConsumer') ?? ''}</span>
            </div>
            <div class="form-field span2">
                <label class="toggle-row" for="fExecuteSynchronous">
                    <span class="toggle">
                        <input class="toggle-input" type="checkbox" id="fExecuteSynchronous" bind:checked={executeSynchronous} />
                        <span class="toggle-track"><span class="toggle-knob"></span></span>
                    </span>
                    <span class="toggle-label">Execute synchronous</span>
                </label>
                <span class="form-hint">Unchecked, the consumer runs as a Queueable — one job per matching subscription, against the async limit.</span>
            </div>
        </div>
    </div>

    <div class="form-section">
        <div class="form-section-header">
            <span class="form-section-badge">3</span>
            <span class="form-section-title">Record</span>
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
                        placeholder="Sales_Account_TierChanged_Recalc"
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
</div>

{#if !isEdit}
    <div class="pe-form-footer">Writes one .md-meta.xml file · IsActive__c defaults true</div>
{/if}
