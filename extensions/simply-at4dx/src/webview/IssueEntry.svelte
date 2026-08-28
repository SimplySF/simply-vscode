<script lang="ts">
    import { ruleTitle } from './lib/bindingView';
    import type { DomainProcessBindingRules, IndexedIssue } from './types';
    import { postMessage } from './vscodeApi';

    let { entry, rules, clickable }: { entry: IndexedIssue; rules: DomainProcessBindingRules; clickable: boolean } = $props();

    let issue = $derived(entry.issue);
    let meta = $derived([issue.source, issue.sobject].filter((part): part is string => Boolean(part)));

    function open(): void {
        postMessage({ command: 'openIssue', index: entry.index });
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
        }
    }
</script>

{#snippet body()}
    <span class="issue-icon" class:error={issue.severity === 'error'} class:warning={issue.severity !== 'error'}>⚠</span>
    <span class="issue-title">{ruleTitle(rules, issue.rule)}</span>
    {#if issue.developerName}
        <span class="issue-meta">{issue.developerName}</span>
    {/if}
    <span class="issue-meta">{meta.join(' · ')}</span>
    <span class="issue-message">{issue.message}</span>
{/snippet}

{#if clickable}
    <div
        class="issue clickable"
        class:error={issue.severity === 'error'}
        class:warning={issue.severity !== 'error'}
        role="button"
        tabindex="0"
        onclick={open}
        onkeydown={onKeydown}
    >
        {@render body()}
    </div>
{:else}
    <div class="issue" class:error={issue.severity === 'error'} class:warning={issue.severity !== 'error'}>
        {@render body()}
    </div>
{/if}
