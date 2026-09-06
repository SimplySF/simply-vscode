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

    // One badge per row, never a run of them: the Issues column is a shared table track (see
    // `.binding-table` in App.svelte), so a row carrying three rule titles side by side would widen
    // that column for every row and squeeze Class to Inject. A single issue shows its rule title; more
    // than one collapses to a count whose tooltip lists each rule and message on its own line.
    let badgeHasError = $derived(badges.some((entry) => entry.issue.severity === 'error'));
    let badgeLabel = $derived(badges.length === 1 ? ruleTitle(rules, badges[0].issue.rule) : `${badges.length} issues`);
    let badgeTitle = $derived(
        badges.length === 1 ? badges[0].issue.message : badges.map((entry) => `${ruleTitle(rules, entry.issue.rule)}: ${entry.issue.message}`).join('\n'),
    );

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
    title={row.developerName}
    onclick={openClass}
    onkeydown={onKeydown}
>
    <span class="row-order">{row.order}</span>
    <span
        class="type-pill"
        class:type-criteria={row.type === 'Criteria'}
        class:type-inactive={!row.isActive}
    >{typeLabel}</span>
    <span class="row-class">{row.classToInject}</span>
    <span class="row-async" class:row-flag-off={!row.executeAsynchronous}>
        {#if row.executeAsynchronous}
            <span class="row-async-icon"><Icon name="async" /></span>Yes
        {:else}
            —
        {/if}
    </span>
    <span class="row-flag" class:row-flag-off={!row.preventRecursive} title={row.preventRecursive ? 'Recursion prevented' : 'Recursion allowed'}>{row.preventRecursive ? 'Disabled' : '—'}</span>
    <span class="row-flag" class:row-flag-off={!row.logicalInverse} title={row.logicalInverse ? 'Logical inverse enabled' : 'Logical inverse disabled'}>{row.logicalInverse ? 'Yes' : '—'}</span>
    <span class="row-badges">
        {#if badges.length > 0}
            <span class="badge" class:error={badgeHasError} class:warning={!badgeHasError} title={badgeTitle}>⚠ <span class="badge-label">{badgeLabel}</span></span>
        {/if}
    </span>
    <span class="row-status">
        <span class="status-indicator" class:status-active={row.isActive}>
            <span class="status-dot"></span>{row.isActive ? 'Active' : 'Inactive'}
        </span>
    </span>
    <span class="row-edit" title="Edit this binding" role="button" tabindex="0" onclick={editClick} onkeydown={editKeydown}>
        <Icon name="edit" />
    </span>
</div>
