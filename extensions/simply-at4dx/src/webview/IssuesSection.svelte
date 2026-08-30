<script lang="ts">
    import IssueEntry from './IssueEntry.svelte';
    import { ruleTitle } from './lib/bindingView';
    import type { DomainProcessBindingRules, IndexedIssue } from './types';
    import { postMessage } from './vscodeApi';

    let {
        inView,
        elsewhere,
        sobject,
        clickable,
        rules,
    }: {
        inView: IndexedIssue[];
        elsewhere: IndexedIssue[];
        sobject: string;
        clickable: boolean;
        rules: DomainProcessBindingRules;
    } = $props();

    function onOpen(index: number): void {
        postMessage({ command: 'openIssue', index });
    }
</script>

{#if inView.length > 0 || elsewhere.length > 0}
    <div class="section issues" id="issuesSection">
        {#if inView.length > 0}
            <div>
                <div class="section-header">
                    <span class="section-title">In {sobject}</span>
                    <span class="section-count">{inView.length} issue(s)</span>
                </div>
                {#each inView as entry (entry.index)}
                    <IssueEntry {entry} title={ruleTitle(rules, entry.issue.rule)} {clickable} {onOpen} />
                {/each}
            </div>
        {/if}
        {#if elsewhere.length > 0}
            <div>
                <div class="section-header">
                    <span class="section-title">Elsewhere in this scan</span>
                    <span class="section-count">{elsewhere.length} issue(s)</span>
                </div>
                {#each elsewhere as entry (entry.index)}
                    <IssueEntry {entry} title={ruleTitle(rules, entry.issue.rule)} {clickable} {onOpen} />
                {/each}
            </div>
        {/if}
    </div>
{/if}
