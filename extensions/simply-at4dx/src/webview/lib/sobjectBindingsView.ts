/**
 * Pure, DOM-free logic for the SObject Bindings sheet (Stage 1 of docs/design/0017) — groups the
 * SObject-keyed binding types (Selector, Domain, UnitOfWork; never Service, which keys on an interface
 * and lives on its own Service Bindings tab) into one card per SObject.
 */
import type { At4dxBindingRow } from '../types';
import { buildApplicationFactorySections, buildUnitOfWorkRows } from './applicationFactoryView';
import type { ApplicationFactoryViewRow, UnitOfWorkViewRow } from './applicationFactoryView';

export type SObjectBindingCardRow =
    | { kind: 'selector'; row: ApplicationFactoryViewRow }
    | { kind: 'domain'; row: ApplicationFactoryViewRow }
    | { kind: 'domain-gap' }
    | { kind: 'unit-of-work'; row: UnitOfWorkViewRow }
    | { kind: 'unit-of-work-gap' };

export type SObjectBindingCard = {
    sobject: string;
    rows: SObjectBindingCardRow[];
    /** Selector + Domain + UnitOfWork bindings actually present on this card — excludes gap placeholders. */
    bindingCount: number;
    /** 0, 1 (missing Domain xor Unit of Work), or 2 (missing both). Selector has no per-SObject floor, so it never counts as a gap — see 1c's multiplicity copy. */
    gapCount: number;
};

/**
 * Groups `rows` into one card per SObject, ordered to match the Unit of Work commit order (1a's own
 * card ordering): SObjects with a Unit of Work binding first, by ascending sequence (unsequenced ones
 * after every sequenced one — same rule `commitPositions` already applies), then any SObject with no
 * Unit of Work binding at all, alphabetically. A card renders even when its only binding is a Selector
 * or a Domain — the SObject just sorts into the unsequenced tail.
 */
export function buildSObjectBindingCards(rows: At4dxBindingRow[]): SObjectBindingCard[] {
    const sections = buildApplicationFactorySections(rows);
    const selectorRows = sections.find((section) => section.bindingType === 'Selector')?.rows ?? [];
    const domainRows = sections.find((section) => section.bindingType === 'Domain')?.rows ?? [];
    const uowRows = buildUnitOfWorkRows(rows);

    const sobjects = new Set<string>();
    for (const row of [...selectorRows, ...domainRows, ...uowRows]) {
        sobjects.add(row.key);
    }

    const cards: SObjectBindingCard[] = [...sobjects].map((sobject) => {
        const cardSelectors = selectorRows.filter((row) => row.key === sobject);
        const cardDomains = domainRows.filter((row) => row.key === sobject);
        const cardUow = uowRows.filter((row) => row.key === sobject);

        const cardRows: SObjectBindingCardRow[] = [
            ...cardSelectors.map((row): SObjectBindingCardRow => ({ kind: 'selector', row })),
            ...(cardDomains.length > 0 ? cardDomains.map((row): SObjectBindingCardRow => ({ kind: 'domain', row })) : [{ kind: 'domain-gap' } as const]),
            ...(cardUow.length > 0 ? cardUow.map((row): SObjectBindingCardRow => ({ kind: 'unit-of-work', row })) : [{ kind: 'unit-of-work-gap' } as const]),
        ];

        return {
            sobject,
            rows: cardRows,
            bindingCount: cardSelectors.length + cardDomains.length + cardUow.length,
            gapCount: (cardDomains.length === 0 ? 1 : 0) + (cardUow.length === 0 ? 1 : 0),
        };
    });

    const sequenceRank = new Map<string, number>();
    const bySequence = [...uowRows].filter((row) => row.sequence !== undefined).sort((a, b) => a.sequence! - b.sequence!);
    let rank = 0;
    for (const row of bySequence) {
        if (!sequenceRank.has(row.key)) {
            sequenceRank.set(row.key, rank++);
        }
    }

    return cards.sort((a, b) => {
        const rankA = sequenceRank.get(a.sobject);
        const rankB = sequenceRank.get(b.sobject);
        if (rankA !== undefined && rankB !== undefined) {
            return rankA - rankB;
        }
        if (rankA !== undefined) {
            return -1;
        }
        if (rankB !== undefined) {
            return 1;
        }
        return a.sobject.localeCompare(b.sobject);
    });
}
