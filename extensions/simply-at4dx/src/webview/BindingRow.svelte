<script lang="ts">
    import Icon from './Icon.svelte';
    import { ruleTitle } from './lib/bindingView';
    import type { DomainProcessBindingRow, DomainProcessBindingRules, IndexedIssue } from './types';
    import { postMessage } from './vscodeApi';

    let {
        row,
        badges,
        rules,
        onEdit,
    }: {
        row: DomainProcessBindingRow;
        badges: IndexedIssue[];
        rules: DomainProcessBindingRules;
        onEdit: (row: DomainProcessBindingRow) => void;
    } = $props();

    let typeLabel = $derived(row.type === 'Criteria' ? 'Criteria' : 'Action');

    function openClass(): void {
        postMessage({ command: 'openClass', classToInject: row.classToInject });
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openClass();
        }
    }

    function editClick(event: MouseEvent): void {
        event.stopPropagation();
        onEdit(row);
    }

    function editKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onEdit(row);
        }
    }
</script>

<div
    class="row row-grid"
    class:inactive={!row.isActive}
    role="button"
    tabindex="0"
    title={`Recursion: ${row.preventRecursive ? 'Enabled' : 'Disabled'} · Logical Inverse: ${row.logicalInverse ? 'Yes' : 'No'}`}
    onclick={openClass}
    onkeydown={onKeydown}
>
    <span class="row-order">{row.order}</span>
    <span
        class="type-pill"
        class:type-criteria={row.type === 'Criteria'}
        class:type-inactive={!row.isActive}
    >{typeLabel}{row.executeAsynchronous ? ' · async' : ''}</span>
    <span class="row-class">{row.classToInject}</span>
    <span class="row-flag" class:row-flag-off={!row.preventRecursive}>{row.preventRecursive ? 'Enabled' : '—'}</span>
    <span class="row-flag" class:row-flag-off={!row.logicalInverse}>{row.logicalInverse ? 'Yes' : '—'}</span>
    <span class="row-status">
        {#each badges as entry (entry.index)}
            <span class="badge" class:error={entry.issue.severity === 'error'} class:warning={entry.issue.severity !== 'error'} title={entry.issue.message}>
                ⚠ {ruleTitle(rules, entry.issue.rule)}
            </span>
        {/each}
        <span class="status-indicator" class:status-active={row.isActive}>
            <span class="status-dot"></span>{row.isActive ? 'Active' : 'Inactive'}
        </span>
    </span>
    <span class="row-edit" title="Edit this binding" role="button" tabindex="0" onclick={editClick} onkeydown={editKeydown}>
        <Icon name="edit" />
    </span>
</div>
