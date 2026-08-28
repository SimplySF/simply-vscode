<script lang="ts">
    type IconName = 'crown' | 'edit';

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
{/if}
