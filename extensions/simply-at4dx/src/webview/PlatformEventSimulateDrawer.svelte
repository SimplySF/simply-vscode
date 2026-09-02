<script lang="ts">
    import { untrack } from 'svelte';
    import { missReasonClause } from './lib/platformEventView';
    import type { PlatformEventDistributionResult, RawPlatformEventSubscriptionRecord } from './types';
    import { postMessage } from './vscodeApi';

    let { records, onCancel }: { records: RawPlatformEventSubscriptionRecord[]; onCancel: () => void } = $props();

    let eventBuses = $derived([...new Set(records.map((record) => record.eventBus))].sort((a, b) => a.localeCompare(b)));
    let eventBus = $state(untrack(() => eventBuses[0]) ?? '');
    let category = $state('');
    let eventName = $state('');
    let result = $state<PlatformEventDistributionResult | undefined>(undefined);

    let subscriptionsOnBus = $derived(records.filter((record) => record.eventBus === eventBus.trim()).length);

    function runSimulation(): void {
        const trimmedBus = eventBus.trim();
        if (!trimmedBus) {
            result = undefined;
            return;
        }
        postMessage({
            command: 'simulatePlatformEvent',
            event: { eventBus: trimmedBus, category: category.trim() || undefined, eventName: eventName.trim() || undefined },
        });
    }

    // Re-runs whenever eventBus/category/eventName change — each read inside `runSimulation` registers
    // as this effect's dependency, same pattern the rest of this codebase's `$effect`s already rely on.
    $effect(() => {
        runSimulation();
    });

    $effect(() => {
        function onMessage(event: MessageEvent): void {
            const message = event.data as { command?: string; result?: PlatformEventDistributionResult };
            if (message.command === 'simulateResult') {
                result = message.result;
            }
        }
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    });
</script>

<div class="form-context-bar">
    <span class="form-title">Simulate a match</span>
    <span class="form-context-spacer"></span>
    <button class="secondary" onclick={onCancel}>Close</button>
</div>

<div class="pe-sim-fields">
    <div class="form-field">
        <label for="peSimEventBus">Event Bus</label>
        <select id="peSimEventBus" bind:value={eventBus}>
            {#each eventBuses as bus (bus)}
                <option value={bus}>{bus}</option>
            {/each}
        </select>
    </div>
    <div class="pe-sim-fields-row">
        <div class="form-field">
            <label for="peSimCategory">Category__c</label>
            <input type="text" id="peSimCategory" bind:value={category} placeholder="e.g. Account" />
        </div>
        <div class="form-field">
            <label for="peSimEventName">EventName__c</label>
            <input type="text" id="peSimEventName" bind:value={eventName} placeholder="e.g. TierChanged" />
        </div>
    </div>
</div>

{#if !eventBus.trim()}
    <p class="empty">No event buses to simulate against.</p>
{:else if result}
    <div class="pe-sim-results">
        <span class="pe-sim-summary">{result.matches.length} of {subscriptionsOnBus} subscription{subscriptionsOnBus === 1 ? '' : 's'} on this bus would receive it</span>

        {#if result.matches.length > 0}
            <div class="pe-sim-matches">
                {#each result.matches as match, i (match.developerName + match.source)}
                    <div class="pe-sim-match">
                        <span class="pe-sim-match-index">{i + 1}</span>
                        <span class="pe-sim-match-consumer">{match.consumer}</span>
                        <span class="pe-sim-match-mode" class:pe-mode-async={!match.executeSynchronous}>
                            {match.executeSynchronous ? 'in-process' : '⟳ 1 Queueable'}
                        </span>
                    </div>
                {/each}
            </div>
        {/if}

        {#if result.misses.length > 0}
            <span class="pe-sim-section-label">Did not match</span>
            <div class="pe-sim-misses">
                {#each result.misses as miss (miss.developerName + miss.source)}
                    <div class="pe-sim-miss">
                        <span class="pe-sim-miss-consumer">{miss.consumer}</span>
                        <span class="pe-sim-miss-reason">{missReasonClause(miss, records)}</span>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
{/if}
