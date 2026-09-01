<script lang="ts">
    import IssueEntry from './IssueEntry.svelte';
    import type { IndexedIssue, PlatformEventSubscriptionIssue, PlatformEventSubscriptionRuleInfo, PlatformEventSubscriptionIssueRule } from './types';
    import { postMessage } from './vscodeApi';

    let {
        errors,
        warnings,
        clickable,
        rules,
    }: {
        errors: IndexedIssue<PlatformEventSubscriptionIssue>[];
        warnings: IndexedIssue<PlatformEventSubscriptionIssue>[];
        clickable: boolean;
        rules: Record<PlatformEventSubscriptionIssueRule, PlatformEventSubscriptionRuleInfo>;
    } = $props();

    function ruleTitle(rule: PlatformEventSubscriptionIssueRule): string {
        return rules[rule]?.title ?? rule;
    }

    function onOpen(index: number): void {
        postMessage({ command: 'openPlatformEventIssue', index });
    }
</script>

{#if errors.length > 0 || warnings.length > 0}
    <div class="section issues" id="platformEventIssuesSection">
        {#if errors.length > 0}
            <div>
                <div class="section-header">
                    <span class="section-title">Errors</span>
                    <span class="section-count">{errors.length} issue(s)</span>
                </div>
                {#each errors as entry (entry.index)}
                    <IssueEntry {entry} title={ruleTitle(entry.issue.rule)} {clickable} {onOpen} />
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
                    <IssueEntry {entry} title={ruleTitle(entry.issue.rule)} {clickable} {onOpen} />
                {/each}
            </div>
        {/if}
    </div>
{/if}
