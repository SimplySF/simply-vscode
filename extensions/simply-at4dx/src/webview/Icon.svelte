<script lang="ts">
    type IconName =
        | 'criteria'
        | 'action'
        | 'async'
        | 'crown'
        | 'edit'
        | 'recursion-prevented'
        | 'recursion-allowed'
        | 'logical-inverse-on'
        | 'logical-inverse-off';

    let { name }: { name: IconName } = $props();
</script>

{#if name === 'criteria'}
    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14l-5.5 6.2V13l-3 1.6V8.2L1 2z" /></svg>
{:else if name === 'action'}
    <svg viewBox="0 0 16 16" fill="currentColor"><path d="M9 1 2.5 9.5H7L6 15l6.5-8.5H8L9 1z" /></svg>
{:else if name === 'async'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 3l5 5-5 5M8 3l5 5-5 5" />
    </svg>
{:else if name === 'crown'}
    <svg viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 5l3 2 4-4 4 4 3-2-1.5 8h-11L1 5zm2.5 9.5h9v1h-9v-1z" />
    </svg>
{:else if name === 'edit'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 2l3 3-8 8-3.5 1 1-3.5 8-8z" />
    </svg>
{:else if name === 'recursion-allowed'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13.5 8A5.5 5.5 0 1 1 11.8 4.2" />
        <path d="M13.8 1.8L13.5 5.3L10 5" />
    </svg>
{:else if name === 'recursion-prevented'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13.5 8A5.5 5.5 0 1 1 11.8 4.2" />
        <path d="M13.8 1.8L13.5 5.3L10 5" />
        <path d="M2.5 2.5L13.5 13.5" stroke-width="1.6" />
    </svg>
{:else if name === 'logical-inverse-off'}
    <svg viewBox="0 0 16 16">
        <path d="M2 3L2 13L11 8Z" fill="currentColor" />
        <circle cx="13" cy="8" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3" />
    </svg>
{:else if name === 'logical-inverse-on'}
    <svg viewBox="0 0 16 16">
        <path d="M2 3L2 13L11 8Z" fill="currentColor" />
        <circle cx="13" cy="8" r="1.6" fill="currentColor" />
    </svg>
{/if}
