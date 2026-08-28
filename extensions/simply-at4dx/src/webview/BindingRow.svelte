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

<div class="row" class:inactive={!row.isActive} role="button" tabindex="0" onclick={openClass} onkeydown={onKeydown}>
    <span class="row-icon">
        {#if row.executeAsynchronous}
            <span class="async-icon" title="Executes asynchronously"><Icon name="async" /></span>
        {/if}
        <Icon name={row.type === 'Criteria' ? 'criteria' : 'action'} />
    </span>
    <span class="row-name">{row.developerName}</span>
    <span class="row-order">Order: {row.order}</span>
    {#each badges as entry (entry.index)}
        <span class="badge" class:error={entry.issue.severity === 'error'} class:warning={entry.issue.severity !== 'error'} title={entry.issue.message}>
            ⚠ {ruleTitle(rules, entry.issue.rule)}
        </span>
    {/each}
    <span class="pill" class:inactive={!row.isActive}>{row.isActive ? 'Active' : 'Inactive'}</span>
    <span class="row-edit" title="Edit this binding" role="button" tabindex="0" onclick={editClick} onkeydown={editKeydown}>
        <Icon name="edit" />
    </span>
</div>
