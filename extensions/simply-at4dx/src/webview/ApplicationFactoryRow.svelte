<script lang="ts">
    import type { ApplicationFactoryViewRow } from './lib/applicationFactoryView';
    import { postMessage } from './vscodeApi';

    let { row, showPriority }: { row: ApplicationFactoryViewRow; showPriority: boolean } = $props();

    function openClass(): void {
        if (row.to) {
            postMessage({ command: 'openClass', classToInject: row.to });
        }
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openClass();
        }
    }
</script>

<div class="row af-row-grid" class:no-priority={!showPriority}>
    <span title={row.key}>{row.key}</span>
    <span class="af-arrow">→</span>
    {#if row.to}
        <span class="row-class" role="button" tabindex="0" title={row.to} onclick={openClass} onkeydown={onKeydown}>{row.to}</span>
    {:else}
        <span></span>
    {/if}
    {#if showPriority}
        <span class="af-priority" class:af-priority-blank={row.priority === undefined} class:af-priority-tied={row.resolution.kind === 'tie-winner' || row.resolution.kind === 'tie-other'}>
            {row.priority ?? '—'}
        </span>
    {/if}
    <span title={row.source}>{row.source}</span>
    <span class="row-status">
        {#if row.resolution.kind === 'effective'}
            <span class="status-indicator status-active"><span class="status-dot"></span>Effective</span>
        {:else if row.resolution.kind === 'shadowed'}
            <span class="status-indicator"><span class="status-dot"></span>Shadowed</span>
        {:else if row.resolution.kind === 'tie-winner'}
            <span class="af-resolution-chip resolves-today">Resolves today</span>
        {:else if row.resolution.kind === 'tie-other'}
            <span class="af-resolution-chip">May win instead</span>
        {:else if row.resolution.kind === 'ambiguous'}
            <span class="af-resolution-chip ambiguous">Ambiguous</span>
        {/if}
    </span>
    <span></span>
</div>
