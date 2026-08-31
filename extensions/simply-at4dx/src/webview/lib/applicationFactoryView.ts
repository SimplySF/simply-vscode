/**
 * Pure, DOM-free logic for the Application Factory explorer — mirrors `bindingView.ts`'s role for the
 * Domain Process explorer. See docs/design/0016.
 */
import type { ApplicationFactoryFormInitial, At4dxBindingRow, BindingIssue, BindingType, IndexedIssue } from '../types';

/** AT4DX's own conceptual order — what does the work, what reads, what owns, what commits. Stable across scans, so a section never moves. */
export const SECTION_ORDER: BindingType[] = ['Service', 'Selector', 'Domain', 'UnitOfWork'];

/**
 * Duplicated from `simply-aep-core`'s own `isCustomObjectApiName` (the webview can't import the
 * ESM-only package — see docs/design/0016's Binding SObject field section). Salesforce reserves `__` in
 * a standard object's API name for exactly this suffix (`__c`, a namespace prefix, `__e`, `__b`/`__x`),
 * so any name containing it always satisfies EntityDefinition's Metadata Relationship eligibility rule
 * on its own — this one-line rule is stable enough to duplicate rather than round-trip through the host.
 */
export function isCustomObjectApiName(apiName: string): boolean {
    return apiName.includes('__');
}

export type ResolutionState =
    | { kind: 'effective' }
    | { kind: 'shadowed' }
    /** Amber, "RESOLVES TODAY" — one of a tied group of Service/Selector rows, the one `effective: true` names. */
    | { kind: 'tie-winner' }
    /** Amber, "MAY WIN INSTEAD" — the rest of a tied group. */
    | { kind: 'tie-other' }
    /** Domain only: no priority field to break a same-key tie. */
    | { kind: 'ambiguous' }
    /** UnitOfWork only: every record contributes, there is no winner concept. */
    | { kind: 'always' };

export type ApplicationFactoryViewRow = At4dxBindingRow & { resolution: ResolutionState };

/**
 * Maps a scanned row (`key`/`keyField`) onto `ApplicationFactoryForm`'s field names (`bindingInterface`
 * for Service, `sobject`/`sobjectAlternate` for Selector/Domain/UnitOfWork) for the edit form's prefill.
 * See docs/design/0016.
 */
export function applicationFactoryRowToFormInitial(row: At4dxBindingRow): ApplicationFactoryFormInitial {
    const base = {
        bindingType: row.bindingType,
        developerName: row.developerName,
        label: row.label,
    };
    if (row.bindingType === 'Service') {
        return { ...base, bindingInterface: row.key, to: row.to ?? '', priority: row.priority };
    }
    if (row.bindingType === 'UnitOfWork') {
        return { ...base, sobject: row.key, sobjectAlternate: row.keyField === 'alternate', sequence: row.sequence };
    }
    return { ...base, sobject: row.key, sobjectAlternate: row.keyField === 'alternate', to: row.to ?? '', priority: row.priority };
}

export type ApplicationFactorySection = {
    bindingType: BindingType;
    /** `Interface` for Service, `SObject` otherwise. */
    keyHeader: string;
    /** Service/Selector only — Domain has no `Priority__c`. */
    showPriority: boolean;
    rows: ApplicationFactoryViewRow[];
};

/** `undefined` sorts below any real number, including `0` — never treat a blank priority as `0`. */
function priorityRank(priority: number | undefined): number {
    return priority === undefined ? Number.NEGATIVE_INFINITY : priority;
}

/**
 * Derives the `ResolutionState` for every row of one binding type's records, grouped by `key`. See
 * docs/design/0016's "Resolution states" table — this is the one place being wrong is worse than being
 * ugly, so it mirrors `simply-aep-core`'s own `at4dxResolve.ts` exactly rather than re-deriving the rule
 * from first principles: Service/Selector tie-break on `priority` (undefined lowest, never `0`), Domain
 * has no priority field so a shared key is `ambiguous` rather than resolved, UnitOfWork never renders a
 * resolution at all.
 */
function resolveRows(bindingType: BindingType, rows: At4dxBindingRow[]): ApplicationFactoryViewRow[] {
    if (bindingType === 'UnitOfWork') {
        return rows.map((row) => ({ ...row, resolution: { kind: 'always' } }));
    }
    if (bindingType === 'Domain') {
        return rows.map((row) => ({ ...row, resolution: row.ambiguous ? { kind: 'ambiguous' } : { kind: 'effective' } }));
    }

    const byKey = new Map<string, At4dxBindingRow[]>();
    for (const row of rows) {
        const group = byKey.get(row.key) ?? [];
        group.push(row);
        byKey.set(row.key, group);
    }

    const resolved: ApplicationFactoryViewRow[] = [];
    for (const row of rows) {
        const group = byKey.get(row.key) ?? [row];
        const maxRank = Math.max(...group.map((r) => priorityRank(r.priority)));
        const tied = group.filter((r) => priorityRank(r.priority) === maxRank);
        if (tied.length > 1) {
            resolved.push({ ...row, resolution: { kind: row.effective ? 'tie-winner' : 'tie-other' } });
        } else {
            resolved.push({ ...row, resolution: { kind: row.effective ? 'effective' : 'shadowed' } });
        }
    }
    return resolved;
}

/** The priority every row in a tie group shares, for the tie banner's copy (`AT4DX Bindings Redesign.dc.html` turn 12a: "both at priority **10**"). `'blank'` when the tie is between two rows that both have no priority set at all. */
export function tiedPriorityLabel(rows: { priority?: number }[]): string {
    const priority = rows[0]?.priority;
    return priority === undefined ? 'blank' : String(priority);
}

/** Groups `rows` (already flat, in `resolveBindings`'s order) into the sections the panel renders, in `SECTION_ORDER`. A binding type with no records produces no section. Excludes UnitOfWork — see `buildUnitOfWorkRows`. */
export function buildApplicationFactorySections(rows: At4dxBindingRow[]): ApplicationFactorySection[] {
    const sections: ApplicationFactorySection[] = [];
    for (const bindingType of SECTION_ORDER) {
        if (bindingType === 'UnitOfWork') {
            continue;
        }
        const typeRows = rows.filter((row) => row.bindingType === bindingType);
        if (typeRows.length === 0) {
            continue;
        }
        sections.push({
            bindingType,
            keyHeader: bindingType === 'Service' ? 'Interface' : 'SObject',
            showPriority: bindingType === 'Service' || bindingType === 'Selector',
            rows: resolveRows(bindingType, typeRows),
        });
    }
    return sections;
}

/**
 * Consecutive runs of `rows` sharing the same `key` — how `ApplicationFactorySections.svelte` decides
 * where to render the "RESOLVES TODAY" / "MAY WIN INSTEAD" tie banner once per group rather than once
 * per row. Relies on `resolveBindings` already grouping same-key records adjacently within a type.
 */
export function groupsByKey<T extends { key: string }>(rows: T[]): { key: string; rows: T[] }[] {
    const groups: { key: string; rows: T[] }[] = [];
    for (const row of rows) {
        const last = groups[groups.length - 1];
        if (last && last.key === row.key) {
            last.rows.push(row);
        } else {
            groups.push({ key: row.key, rows: [row] });
        }
    }
    return groups;
}

export type UnitOfWorkViewRow = At4dxBindingRow & {
    /** `'1st'`, `'2nd or 3rd'` for a tied rank, `undefined` when no sequence is set — never invent a position for an unsequenced row. */
    commitPosition?: string;
    /** `true` when this row shares its `sequence` with at least one other row — a `sequence-collision`. Drives the amber Sequence/Commits cells and the collision banner. See AT4DX Bindings Redesign.dc.html turn 13b. */
    tied: boolean;
};

/** Contiguous-by-value groups of `rows` sharing a defined `sequence` — a `sequence-collision`. Unsequenced rows never form a group (blank is the ordinary unordered default, never flagged). */
function sequenceCollisionGroups(rows: At4dxBindingRow[]): { sequence: number; rows: At4dxBindingRow[] }[] {
    const sequenced = rows.filter((row) => row.sequence !== undefined).sort((a, b) => a.sequence! - b.sequence!);
    const groups: { sequence: number; rows: At4dxBindingRow[] }[] = [];
    let index = 0;
    while (index < sequenced.length) {
        let end = index;
        while (end + 1 < sequenced.length && sequenced[end + 1].sequence === sequenced[index].sequence) {
            end += 1;
        }
        if (end > index) {
            groups.push({ sequence: sequenced[index].sequence!, rows: sequenced.slice(index, end + 1) });
        }
        index = end + 1;
    }
    return groups;
}

/** UnitOfWork's rows, in `resolveBindings`'s order (ascending by sequence, unsequenced last — see `at4dxResolve.ts`), each annotated with its commit position and whether it's part of a sequence collision. */
export function buildUnitOfWorkRows(rows: At4dxBindingRow[]): UnitOfWorkViewRow[] {
    const uowRows = rows.filter((row) => row.bindingType === 'UnitOfWork');
    const positions = commitPositions(uowRows);
    const tiedKeys = new Set(sequenceCollisionGroups(uowRows).flatMap((group) => group.rows.map(recordKey)));
    return uowRows.map((row) => ({ ...row, commitPosition: positions.get(recordKey(row)), tied: tiedKeys.has(recordKey(row)) }));
}

/**
 * Groups of consecutive tied rows sharing a sequence, from an already-`buildUnitOfWorkRows`-annotated
 * list — how `UnitOfWorkSections.svelte` decides where to render the collision banner (once per group,
 * immediately above its first row) and how many to count in the toolbar's "N warning".
 */
export function unitOfWorkCollisionGroups(rows: UnitOfWorkViewRow[]): { sequence: number; rows: UnitOfWorkViewRow[] }[] {
    const groups: { sequence: number; rows: UnitOfWorkViewRow[] }[] = [];
    for (const row of rows) {
        if (!row.tied) {
            continue;
        }
        const last = groups[groups.length - 1];
        if (last && last.sequence === row.sequence) {
            last.rows.push(row);
        } else {
            groups.push({ sequence: row.sequence!, rows: [row] });
        }
    }
    return groups;
}

/**
 * Computes the minimal `updateBinding` calls a Unit of Work drag-and-drop reorder needs: moves
 * `draggedDeveloperName` to `dropIndex` in `rows`' display order, renumbers by tens (`10, 20, 30, …`)
 * every row that already had a sequence plus the dragged row itself, and returns only the ones whose
 * sequence actually changed. An unsequenced row not being dragged is left untouched — a drag is how a
 * row gets a sequence in the first place, not something that happens to it as a side effect of someone
 * else's move. See AT4DX Bindings Redesign.dc.html turn 13b and docs/design/0016.
 *
 * `dropIndex` is the target row's own index in `rows` (before removal) — inserting the dragged item
 * there after it's spliced out of its old position lands it immediately after the target when dragging
 * downward and immediately before it when dragging upward, with no direction-specific adjustment needed.
 */
export function planUnitOfWorkReorder(rows: At4dxBindingRow[], draggedDeveloperName: string, dropIndex: number): { developerName: string; sequence: number }[] {
    const fromIndex = rows.findIndex((row) => row.developerName === draggedDeveloperName);
    if (fromIndex === -1 || fromIndex === dropIndex) {
        return [];
    }

    const reordered = [...rows];
    const [dragged] = reordered.splice(fromIndex, 1);
    reordered.splice(dropIndex, 0, dragged);

    const toRenumber = reordered.filter((row) => row.sequence !== undefined || row.developerName === draggedDeveloperName);
    const moves: { developerName: string; sequence: number }[] = [];
    toRenumber.forEach((row, index) => {
        const sequence = (index + 1) * 10;
        if (row.sequence !== sequence) {
            moves.push({ developerName: row.developerName, sequence });
        }
    });
    return moves;
}

function recordKey(row: At4dxBindingRow): string {
    return `${row.developerName} ${row.source}`;
}

/** `1st`, `2nd`, `3rd`, `4th`, `11th`, `21st`, ... */
export function ordinal(n: number): string {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) {
        return `${n}th`;
    }
    switch (n % 10) {
        case 1:
            return `${n}st`;
        case 2:
            return `${n}nd`;
        case 3:
            return `${n}rd`;
        default:
            return `${n}th`;
    }
}

/**
 * Ordinal commit-position labels for the Unit of Work commit order, keyed by `developerName + source`
 * (the composite key — a bare `developerName` isn't unique across packages, and `duplicate-developer-name`
 * exists precisely because it can collide). Records sharing a sequence share an either/or label
 * (`'2nd or 3rd'`); records with no sequence get no entry at all — blank is the ordinary unordered
 * default, and the panel must not invent a position for them or try to place them relative to the
 * numbered ones (the consuming SOQL orders with no null handling).
 */
export function commitPositions(rows: At4dxBindingRow[]): Map<string, string> {
    const sequenced = rows.filter((row) => row.sequence !== undefined).sort((a, b) => a.sequence! - b.sequence!);

    const positions = new Map<string, string>();
    let index = 0;
    while (index < sequenced.length) {
        const startRank = index + 1;
        let end = index;
        while (end + 1 < sequenced.length && sequenced[end + 1].sequence === sequenced[index].sequence) {
            end += 1;
        }
        const endRank = end + 1;
        const label = startRank === endRank ? ordinal(startRank) : `${ordinal(startRank)} or ${ordinal(endRank)}`;
        for (let i = index; i <= end; i++) {
            positions.set(recordKey(sequenced[i]), label);
        }
        index = end + 1;
    }
    return positions;
}

/**
 * Live preview of where a Unit of Work binding would land in the commit order if saved with `sequence`
 * right now — the form's "resulting binding" sentence (stage 3, see docs/design/0016). Reuses
 * `commitPositions` against `existingRows` (every other UnitOfWork row in the current scan, i.e. not
 * including the one being edited) plus one synthetic row standing in for the form's current input, so
 * the preview accounts for ties with real rows the same way the list view does.
 */
export function previewCommitPosition(existingRows: At4dxBindingRow[], editingDeveloperName: string | undefined, sequence: number | undefined): { label: string; total: number } {
    const PREVIEW_KEY = '__preview__';
    const others = existingRows.filter((row) => row.developerName !== editingDeveloperName);
    const synthetic = { bindingType: 'UnitOfWork', developerName: PREVIEW_KEY, label: '', key: '', source: PREVIEW_KEY, effective: true, sequence } as At4dxBindingRow;
    const all = [...others, synthetic];
    const label = commitPositions(all).get(`${PREVIEW_KEY} ${PREVIEW_KEY}`) ?? 'unordered — no sequence set';
    return { label, total: all.length };
}

/** Splits the whole scan's issues into `errors`/`warnings`, index-tagged against the full `issues` array so a click's `openApplicationFactoryIssue` index still resolves against the host's own copy. See docs/design/0016's Problems section — grouped error-then-warning, one row per issue, no other categorization. */
export function partitionBySeverity(issues: BindingIssue[]): { errors: IndexedIssue<BindingIssue>[]; warnings: IndexedIssue<BindingIssue>[] } {
    const indexed = issues.map((issue, index) => ({ issue, index }));
    return {
        errors: indexed.filter((entry) => entry.issue.severity === 'error'),
        warnings: indexed.filter((entry) => entry.issue.severity === 'warning'),
    };
}
