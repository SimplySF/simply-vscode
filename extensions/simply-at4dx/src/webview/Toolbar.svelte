<script lang="ts">
    import type { FamilyKey } from './types';

    let {
        sobjects,
        sobject = $bindable(),
        familyItems,
        family = $bindable(),
        canWrite,
        onNewBinding,
    }: {
        sobjects: string[];
        sobject: string;
        familyItems: { value: FamilyKey; label: string }[];
        family: FamilyKey | undefined;
        canWrite: boolean;
        onNewBinding: () => void;
    } = $props();
</script>

<div class="toolbar">
    <label>
        SObject
        <select bind:value={sobject}>
            {#each sobjects as option (option)}
                <option value={option}>{option}</option>
            {/each}
        </select>
    </label>
    <label>
        Trigger Event
        <select bind:value={family}>
            {#each familyItems as item (item.value)}
                <option value={item.value}>{item.label}</option>
            {/each}
        </select>
    </label>
    <span class="spacer"></span>
    <button disabled={!canWrite} onclick={onNewBinding}>+ New Binding</button>
</div>
