<script lang="ts">
    import { isCustomObjectApiName } from './lib/applicationFactoryView';

    let {
        id,
        value = $bindable(),
        alternate = $bindable(),
        standardObjects,
        error,
    }: {
        id: string;
        value: string;
        alternate: boolean;
        standardObjects: string[];
        error?: string;
    } = $props();

    let trimmed = $derived(value.trim());
    let isCustom = $derived(isCustomObjectApiName(trimmed));
    let isKnownStandard = $derived(standardObjects.includes(trimmed));
    // Eligible whenever there's nothing to judge yet (blank) or the name is custom/known-standard —
    // see docs/design/0016's Binding SObject field table. Ineligible is a warning with an escape hatch,
    // never a submit-blocking error: `ENTITY_DEFINITION_STANDARD_OBJECTS` is explicitly best-effort.
    let eligible = $derived(trimmed === '' || isCustom || isKnownStandard);

    function useAsAlternate(): void {
        alternate = true;
    }

    function clearAlternate(): void {
        alternate = false;
    }
</script>

<div class="form-field">
    <label for={id}>Binding SObject <span class="required-marker">*</span></label>
    <input type="text" {id} class:field-invalid={Boolean(error)} bind:value placeholder="Account" />
    {#if alternate}
        <span class="af-sobject-chip">
            ALTERNATE
            <button type="button" class="af-sobject-chip-clear" title="Use the primary field instead" onclick={clearAlternate}>✕</button>
        </span>
        <span class="form-hint">Stored in the alternate (plain text) field — clearing this uses the primary field instead.</span>
    {:else if trimmed !== '' && eligible}
        <span class="form-hint af-sobject-hint-ok">
            {isCustom ? 'Eligible — deploy still fails if it doesn’t exist.' : 'Eligible — supports metadata relationships.'}
        </span>
    {:else if trimmed !== '' && !eligible}
        <span class="form-hint af-sobject-hint-error">
            "{trimmed}" isn't known to support metadata relationships.
            <button type="button" class="af-sobject-alt-action" onclick={useAsAlternate}>Use "{trimmed}" as an alternate name</button>
        </span>
    {:else}
        <span class="form-hint">Prefilled from the current scope. For Setup objects like ServiceResource, use the alternate action after typing the name.</span>
    {/if}
    <span class="form-field-error">{error ?? ''}</span>
</div>
