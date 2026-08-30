<script lang="ts">
    import IssueEntry from './IssueEntry.svelte';
    import { ruleTitle } from './lib/bindingView';
    import type { ApplicationFactoryRules, BindingIssue, IndexedIssue } from './types';
    import { postMessage } from './vscodeApi';

    let {
        errors,
        warnings,
        clickable,
        rules,
    }: {
        errors: IndexedIssue<BindingIssue>[];
        warnings: IndexedIssue<BindingIssue>[];
        clickable: boolean;
        rules: ApplicationFactoryRules;
    } = $props();

    function onOpen(index: number): void {
        postMessage({ command: 'openApplicationFactoryIssue', index });
    }
</script>

{#if errors.length > 0 || warnings.length > 0}
    <div class="section issues" id="applicationFactoryIssuesSection">
        {#if errors.length > 0}
            <div>
                <div class="section-header">
                    <span class="section-title">Errors</span>
                    <span class="section-count">{errors.length} issue(s)</span>
                </div>
                {#each errors as entry (entry.index)}
                    <IssueEntry {entry} title={ruleTitle(rules, entry.issue.rule)} {clickable} {onOpen} />
                {/each}
            </div>
        {/if}
        {#if warnings.length > 0}
            <div>
                <div class="section-header">
                    <span class="section-title">Warnings</span>
                    <span class="section-count">{warnings.length} issue(s)</span>
                </div>
                {#each warnings as entry (entry.index)}
                    <IssueEntry {entry} title={ruleTitle(rules, entry.issue.rule)} {clickable} {onOpen} />
                {/each}
            </div>
        {/if}
    </div>
{/if}
