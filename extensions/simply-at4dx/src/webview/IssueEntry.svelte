<script lang="ts">
    import type { IndexedIssue, IssueLike } from './types';

    let {
        entry,
        title,
        clickable,
        onOpen,
    }: { entry: IndexedIssue<IssueLike>; title: string; clickable: boolean; onOpen: (index: number) => void } = $props();

    let issue = $derived(entry.issue);
    let meta = $derived([issue.source, issue.sobject ?? issue.key].filter((part): part is string => Boolean(part)));

    function open(): void {
        onOpen(entry.index);
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
    <span class="issue-title">{title}</span>
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
