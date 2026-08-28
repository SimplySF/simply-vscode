<script lang="ts">
    type IconName =
        | 'criteria'
        | 'action'
        | 'async'
        | 'crown'
        | 'edit'
        | 'recursion-prevented'
        | 'recursion-allowed'
        | 'logical-inverse';

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
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 8C6 5 2 5 2 8C2 11 6 11 8 8C10 5 14 5 14 8C14 11 10 11 8 8Z" />
    </svg>
{:else if name === 'recursion-prevented'}
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 8C6 5 2 5 2 8C2 11 6 11 8 8C10 5 14 5 14 8C14 11 10 11 8 8Z" />
        <path d="M2.5 2.5L13.5 13.5" stroke-width="1.6" />
    </svg>
{:else if name === 'logical-inverse'}
    <svg viewBox="0 0 512 512" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd">
        <path
            d="M 258 156
      A 103 103 0 1 1 258 362
      A 103 103 0 1 1 258 156
      Z

      M 258 178
      L 258 342
      C 213.3 342 177 305.3 177 260
      C 177 214.7 213.3 178 258 178
      Z"
        />
    </svg>
{/if}
