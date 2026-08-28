<script lang="ts">
    import type { IndexedIssue } from './types';

    let { inView, elsewhere }: { inView: IndexedIssue[]; elsewhere: IndexedIssue[] } = $props();

    let total = $derived(inView.length + elsewhere.length);
    let all = $derived([...inView, ...elsewhere].map((entry) => entry.issue));
    let errors = $derived(all.filter((issue) => issue.severity === 'error').length);
    let warnings = $derived(all.filter((issue) => issue.severity === 'warning').length);
    let parts = $derived(
        [inView.length ? `${inView.length} in this SObject` : undefined, elsewhere.length ? `${elsewhere.length} elsewhere in this scan` : undefined].filter(
            (part): part is string => Boolean(part),
        ),
    );

    function scrollToIssues(): void {
        document.getElementById('issuesSection')?.scrollIntoView({ behavior: 'smooth' });
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            scrollToIssues();
        }
    }
</script>

{#if total === 0}
    <div class="summary clean">✓ No problems found</div>
{:else}
    <div class="summary problem" role="button" tabindex="0" onclick={scrollToIssues} onkeydown={onKeydown}>
        ⚠ {errors} error(s) &middot; {warnings} warning(s) ({parts.join(', ')})
    </div>
{/if}
