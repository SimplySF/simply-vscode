/**
 * Pure, DOM-free logic for field set inclusions (Stage 4 of docs/design/0017) — every active record for
 * a Selector's SObject contributes its field set simultaneously (there's no priority/winner concept the
 * way bindings have), so this is deliberately simpler than `applicationFactoryView.ts`'s own resolution
 * logic: filtering, counting, and grouping by SObject, nothing more.
 */
import type { RawFieldSetInclusionRecord } from '../types';

/** Active inclusions for `sobject`, in scan order. Inactive ones are never shown — see docs/design/0017's "remove sets isActive: false, not shown crossed-out" decision. */
export function activeFieldSetInclusionsForSObject(records: RawFieldSetInclusionRecord[], sobject: string): RawFieldSetInclusionRecord[] {
    const trimmed = sobject.trim();
    return records.filter((record) => record.isActive && record.sobject === trimmed);
}

/** How many active field set inclusions each SObject has — the SObject Bindings sheet's own "N field sets" text on a Selector row (shared across every Selector on that card, since inclusions are SObject-scoped, not tied to one Selector binding). */
export function fieldSetCountBySObject(records: RawFieldSetInclusionRecord[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const record of records) {
        if (!record.isActive) {
            continue;
        }
        counts.set(record.sobject, (counts.get(record.sobject) ?? 0) + 1);
    }
    return counts;
}

/** `'no field sets'`, `'1 field set'`, `'N field sets'` — the exact wording canvas 1a's Selector rows use. */
export function fieldSetCountLabel(count: number): string {
    if (count === 0) {
        return 'no field sets';
    }
    return `${count} field set${count === 1 ? '' : 's'}`;
}

/**
 * A `DeveloperName` for a new field set inclusion, derived from the SObject and field set name — the
 * canvas's own "Add" affordance (2a section 3, 3a section 3) is just a combobox + Add button, with no
 * separate Developer Name field to type into. Sanitized the same way `developerNameValid` (in
 * `bindingView.ts`) requires: starts with a letter, only letters/digits/single underscores, doesn't end
 * with one, 40 characters or fewer. Falls back to a numeric suffix on a collision against
 * `existingDeveloperNames` — organization-wide uniqueness (per 3f) means the caller must pass every
 * inclusion already in the scan, not just this SObject's.
 */
export function suggestFieldSetInclusionDeveloperName(sobject: string, fieldsetName: string, existingDeveloperNames: Set<string>): string {
    const raw = `${sobject}_${fieldsetName}_Inclusion`;
    const sanitized = raw
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    const withLetterStart = /^[A-Za-z]/.test(sanitized) ? sanitized : `Fs${sanitized}`;
    const base = withLetterStart.slice(0, 40).replace(/_+$/, '') || 'FieldSetInclusion';

    if (!existingDeveloperNames.has(base)) {
        return base;
    }
    for (let suffix = 2; suffix < 1000; suffix++) {
        const suffixed = `${base.slice(0, 40 - String(suffix).length - 1)}_${suffix}`;
        if (!existingDeveloperNames.has(suffixed)) {
            return suffixed;
        }
    }
    return base;
}
