<script lang="ts">
    /**
     * The SObject Bindings sheet's "+ New Binding" split button (canvas 1c) — the sheet holds three
     * SObject-keyed binding types, so the type is the first thing the create drawer needs and the last
     * thing the sheet itself knows. One control at any panel width, and where a fourth SObject-keyed
     * type would land without touching the toolbar (see docs/design/0017's Stage 1 Behavior section —
     * this was deferred out of that stage's own initial cut and is landing now). Service Bindings' own
     * toolbar keeps the plain (non-split) button — Service is the only type there, so there's nothing to
     * choose between (canvas 5a).
     */
    let { disabled = false, onSelect }: { disabled?: boolean; onSelect: (bindingType: 'Selector' | 'Domain' | 'UnitOfWork') => void } = $props();

    let open = $state(false);
    let menuEl = $state<HTMLDivElement | undefined>(undefined);

    function toggle(): void {
        if (!disabled) {
            open = !open;
        }
    }

    function choose(bindingType: 'Selector' | 'Domain' | 'UnitOfWork'): void {
        open = false;
        onSelect(bindingType);
    }

    function onWindowClick(event: MouseEvent): void {
        if (open && menuEl && !menuEl.contains(event.target as Node)) {
            open = false;
        }
    }

    function onWindowKeydown(event: KeyboardEvent): void {
        if (open && event.key === 'Escape') {
            open = false;
        }
    }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<div class="nbm" bind:this={menuEl}>
    <button type="button" class="nbm-button" {disabled} aria-haspopup="true" aria-expanded={open} onclick={toggle}>
        <span>+ New Binding</span>
        <span class="nbm-caret">▾</span>
    </button>
    {#if open}
        <div class="nbm-menu" role="menu">
            <div class="nbm-menu-title">Binding type</div>
            <button type="button" class="nbm-item" role="menuitem" onclick={() => choose('Selector')}>
                <span class="nbm-item-name">Selector</span>
                <span class="nbm-item-desc">Many per SObject — highest <code>Priority__c</code> wins, blank sorts lowest. Carries field set inclusions.</span>
            </button>
            <button type="button" class="nbm-item" role="menuitem" onclick={() => choose('Domain')}>
                <span class="nbm-item-name">Domain</span>
                <span class="nbm-item-desc">One per SObject — a second one fails to deploy rather than shadowing. Domain process bindings need it.</span>
            </button>
            <button type="button" class="nbm-item" role="menuitem" onclick={() => choose('UnitOfWork')}>
                <span class="nbm-item-name">Unit of Work</span>
                <span class="nbm-item-desc">One per SObject — sets the commit position, and has no active flag.</span>
            </button>
            <div class="nbm-menu-footer">Service bindings key on an interface, not an SObject — they are created from their own tab.</div>
        </div>
    {/if}
</div>
