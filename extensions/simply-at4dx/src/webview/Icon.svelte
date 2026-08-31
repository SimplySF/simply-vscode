<script lang="ts">
    type IconName = 'crown' | 'edit' | 'async' | 'domainProcess' | 'sobjectBindings' | 'applicationFactory' | 'platformEvent' | 'moveUp' | 'moveDown';

    let { name }: { name: IconName } = $props();
</script>

{#if name === 'crown'}
    <svg viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 5l3 2 4-4 4 4 3-2-1.5 8h-11L1 5zm2.5 9.5h9v1h-9v-1z" />
    </svg>
{:else if name === 'edit'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 2l3 3-8 8-3.5 1 1-3.5 8-8z" />
    </svg>
{:else if name === 'async'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="8" cy="8" r="6.3" />
        <path d="M8 4.8V8l2.4 1.4" />
    </svg>
{:else if name === 'domainProcess'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 1.3 14.2 8 8 14.7 1.8 8Z" />
    </svg>
{:else if name === 'sobjectBindings'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <rect x="1.5" y="1.5" width="6" height="6" rx="1" />
        <rect x="8.5" y="1.5" width="6" height="6" rx="1" />
        <rect x="1.5" y="8.5" width="6" height="6" rx="1" />
        <rect x="8.5" y="8.5" width="6" height="6" rx="1" />
    </svg>
{:else if name === 'applicationFactory'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
        <path d="M2 4.5h12M2 8h12M2 11.5h12" />
    </svg>
{:else if name === 'moveUp'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3v10M4 7l4-4 4 4" />
    </svg>
{:else if name === 'moveDown'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3v10M4 9l4 4 4-4" />
    </svg>
{:else if name === 'platformEvent'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
        <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
        <path d="M5.3 5.3a3.8 3.8 0 0 0 0 5.4M10.7 5.3a3.8 3.8 0 0 1 0 5.4M3 3a7.3 7.3 0 0 0 0 10M13 3a7.3 7.3 0 0 1 0 10" />
    </svg>
{/if}
