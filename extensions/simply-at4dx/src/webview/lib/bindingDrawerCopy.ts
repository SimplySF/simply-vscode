/**
 * Pure, DOM-free copy builders for the create/edit drawers (Stage 2 of docs/design/0017) — the header
 * verb + record key, the breadcrumb naming the entry point, and the RESULTING BINDING preview sentence,
 * for both `ApplicationFactoryForm.svelte` and `BindingForm.svelte`. Kept separate from the components
 * so every string can be asserted verbatim in a plain Vitest test, matching `SPEC-CONVENTIONS.md`'s
 * "copy is the spec" rule the design doc's canvas extraction was reconciled against.
 *
 * `resultingBinding` is a segment array, not a pre-formatted string with markdown-style `**`/backtick
 * markers: every segment's text can include a class name or SObject name the *user typed into the
 * form*, so it has to render through Svelte's own auto-escaping text interpolation (`{segment.text}`
 * inside a `<strong>`/`<span class="mono-link">` per `emphasis`) rather than `{@html}` — embedding
 * unescaped user input as HTML is exactly the XSS shape this project's own guidance warns against.
 */
import { previewCommitPosition } from './applicationFactoryView';
import type { At4dxBindingRow, ProcessContext, TriggerOperation, WritableBindingType } from '../types';

export type DrawerMode = 'create' | 'edit';

export type CopySegment = { text: string; emphasis?: 'bold' | 'mono' };

function plain(text: string): CopySegment {
    return { text };
}
function bold(text: string): CopySegment {
    return { text, emphasis: 'bold' };
}
function mono(text: string): CopySegment {
    return { text, emphasis: 'mono' };
}

/** `undefined` sorts below any real number, including `0` — mirrors `applicationFactoryView.ts`'s own `priorityRank`, kept local since it's the only thing here that needs it. */
function priorityRank(priority: number | undefined): number {
    return priority === undefined ? Number.NEGATIVE_INFINITY : priority;
}

export type PriorityCompetition = { kind: 'wins' | 'ties' | 'shadowed'; otherLabel: string; otherPriorityLabel: string } | undefined;

/**
 * Who this record's priority competes with — the same resolution `applicationFactoryView.ts`'s
 * `resolveRows` computes, applied live to the value currently typed into the form rather than a saved
 * scan. `undefined` when there's no competing record on this key at all (the common case: a first
 * binding). See canvas 3a/5c.
 */
export function priorityCompetition(siblings: At4dxBindingRow[], key: string, excludeDeveloperName: string | undefined, priority: number | undefined): PriorityCompetition {
    const others = siblings.filter((row) => row.key === key && row.developerName !== excludeDeveloperName);
    if (others.length === 0) {
        return undefined;
    }
    const maxOtherRank = Math.max(...others.map((row) => priorityRank(row.priority)));
    const named = others.filter((row) => priorityRank(row.priority) === maxOtherRank)[0];
    const otherLabel = named.to || named.developerName;
    const otherPriorityLabel = named.priority === undefined ? 'blank' : `priority ${named.priority}`;

    const thisRank = priorityRank(priority);
    const kind = thisRank > maxOtherRank ? 'wins' : thisRank === maxOtherRank ? 'ties' : 'shadowed';
    return { kind, otherLabel, otherPriorityLabel };
}

export type ApplicationFactoryDrawerCopyInput = {
    mode: DrawerMode;
    bindingType: WritableBindingType;
    developerName: string | undefined;
    /** The SObject (Selector/Domain/UnitOfWork) or interface (Service) this binding keys on, as currently typed. */
    key: string;
    to: string;
    priority: number | undefined;
    sequence: number | undefined;
    /** Every other row already in the scan (any binding type) — used to find this record's siblings on the same key. */
    allRows: At4dxBindingRow[];
    /** Domain only — how many Domain Process bindings this SObject has, from the other explorer's own scan. `undefined` while that scan hasn't resolved yet. */
    domainProcessBindingCount: number | undefined;
    /**
     * Whether this create is opening with the SObject already fixed (a card's own "Add" link — canvas
     * 2b/2c) or free-typed (the sheet/tab-level "+ New Binding" button — canvas 2a/5b). Ignored in edit
     * mode, where the breadcrumb always names the record's own key.
     */
    prefilledFromGap: boolean;
};

export type DrawerCopy = {
    /** "New selector binding" / "Edit selector binding" / etc. */
    title: string;
    /** The clickable lead segment of the breadcrumb — `undefined` when there's nothing to navigate back to. */
    breadcrumbLead?: string;
    typePillLabel: string;
    /** CSS class suffix selecting the pill's hue — `af-type-selector`, `af-type-domain`, `af-type-uow`, or `af-type-service`. */
    typePillClass: string;
    breadcrumbSuffix: string;
    resultingBinding: CopySegment[];
    /** Create mode only — the monospace CLI-command footer canvas Turn 2 shows inside every create drawer. `undefined` in edit mode. */
    cliPreview?: string;
};

const AF_TYPE_PILL_CLASS: Record<WritableBindingType, string> = {
    Service: 'af-type-service',
    Selector: 'af-type-selector',
    Domain: 'af-type-domain',
    UnitOfWork: 'af-type-uow',
};

const AF_TYPE_PILL_LABEL: Record<WritableBindingType, string> = {
    Service: 'SERVICE',
    Selector: 'SELECTOR',
    Domain: 'DOMAIN',
    UnitOfWork: 'UNIT OF WORK',
};

const AF_TITLE_NOUN: Record<WritableBindingType, string> = {
    Service: 'service binding',
    Selector: 'selector binding',
    Domain: 'domain binding',
    UnitOfWork: 'Unit of Work binding',
};

function cliFlag(name: string, value: string | number | undefined): string {
    return value === undefined || value === '' ? '' : ` --${name} ${value}`;
}

/** The clause naming a priority competitor, as trailing segments — `[]` when `competition` is `undefined`. */
function competitionSegments(competition: PriorityCompetition, priority: number | undefined): CopySegment[] {
    if (!competition) {
        return [];
    }
    if (competition.kind === 'wins') {
        return [plain(` — wins at priority ${priority ?? '—'} over `), mono(competition.otherLabel), plain(`, which sits shadowed at ${competition.otherPriorityLabel}`)];
    }
    if (competition.kind === 'ties') {
        return [plain(' — ties '), mono(competition.otherLabel), plain(` at ${competition.otherPriorityLabel} — the last one loaded wins`)];
    }
    return [plain(' — shadowed by '), mono(competition.otherLabel), plain(`, which wins at ${competition.otherPriorityLabel}`)];
}

/** Builds the header/breadcrumb/RESULTING BINDING/CLI-preview copy for an Application Factory drawer (Service/Selector/Domain/UnitOfWork). See docs/design/0017's Stage 2 Behavior section and canvas Turns 2, 3, 5. */
export function applicationFactoryDrawerCopy(input: ApplicationFactoryDrawerCopyInput): DrawerCopy {
    const { mode, bindingType, developerName, key, to, priority, sequence, allRows, domainProcessBindingCount, prefilledFromGap } = input;
    const isEdit = mode === 'edit';
    const trimmedKey = key.trim();
    const keyLabel = trimmedKey || (bindingType === 'Service' ? 'interface' : 'SObject');
    const toLabel = to.trim() || '…';

    const title = `${isEdit ? 'Edit' : 'New'} ${AF_TITLE_NOUN[bindingType]}`;
    const typePillLabel = AF_TYPE_PILL_LABEL[bindingType];
    const typePillClass = AF_TYPE_PILL_CLASS[bindingType];

    let breadcrumbLead: string | undefined;
    let breadcrumbSuffix: string;
    if (isEdit) {
        breadcrumbLead = trimmedKey || undefined;
        breadcrumbSuffix = bindingType === 'UnitOfWork' ? (sequence === undefined ? 'unordered' : `sequence ${sequence}`) : toLabel;
    } else if (prefilledFromGap) {
        breadcrumbLead = trimmedKey || undefined;
        breadcrumbSuffix = 'was Not bound';
    } else {
        breadcrumbLead = '+ New Binding';
        breadcrumbSuffix = bindingType === 'Service' ? 'not bound yet' : 'no SObject pre-answered';
    }

    const siblings = allRows.filter((row) => row.bindingType === bindingType);
    const excludeSelf = isEdit ? developerName : undefined;

    let resultingBinding: CopySegment[];
    if (bindingType === 'Service') {
        const competition = priorityCompetition(siblings, trimmedKey, excludeSelf, priority);
        resultingBinding = competition
            ? [plain('Application.Service.newInstance('), mono(`${keyLabel}.class`), plain(') resolves to '), mono(toLabel), ...competitionSegments(competition, priority), plain('.')]
            : [plain('Application.Service.newInstance('), mono(`${keyLabel}.class`), plain(') returns a new '), mono(toLabel), plain(' — this interface has no binding yet.')];
    } else if (bindingType === 'Selector') {
        const competition = priorityCompetition(siblings, trimmedKey, excludeSelf, priority);
        resultingBinding = [
            plain('Selector.newInstance('),
            bold(keyLabel),
            plain(') resolves to '),
            mono(toLabel),
            plain(', with no field sets queried yet'),
            ...competitionSegments(competition, priority),
            plain('.'),
        ];
    } else if (bindingType === 'Domain') {
        if (prefilledFromGap && !isEdit) {
            resultingBinding = [
                bold(keyLabel),
                plain("'s domain process bindings don't resolve today, because nothing provides its domain. Saving this makes them resolve — no change to their own records."),
            ];
        } else {
            const countSuffix =
                domainProcessBindingCount === undefined
                    ? ''
                    : `, and ${domainProcessBindingCount} domain process binding${domainProcessBindingCount === 1 ? '' : 's'} resolve${domainProcessBindingCount === 1 ? 's' : ''} through it`;
            resultingBinding = [plain('Domain.newInstance(records) on '), bold(keyLabel), plain(' resolves to '), mono(toLabel), plain(`${countSuffix}.`)];
        }
    } else {
        const { label: positionLabel, total } = previewCommitPosition(siblings, excludeSelf, sequence);
        resultingBinding = isEdit
            ? [bold(keyLabel), plain(` commits ${positionLabel} of ${total} in the shared Unit of Work.`)]
            : [bold(keyLabel), plain(` joins the shared Unit of Work and commits ${positionLabel} of ${total}.`)];
    }

    if (isEdit) {
        return { title, breadcrumbLead, typePillLabel, typePillClass, breadcrumbSuffix, resultingBinding };
    }

    const cliPreview =
        `binding create --type ${bindingType === 'UnitOfWork' ? 'unit-of-work' : bindingType.toLowerCase()} --developer-name ${developerName?.trim() || '…'}` +
        (bindingType === 'Service' ? cliFlag('binding-interface', trimmedKey || undefined) : cliFlag('sobject', trimmedKey || undefined)) +
        cliFlag('to', bindingType === 'UnitOfWork' ? undefined : to.trim() || undefined) +
        cliFlag('priority', bindingType === 'Service' || bindingType === 'Selector' ? priority : undefined) +
        cliFlag('sequence', bindingType === 'UnitOfWork' ? sequence : undefined);

    return { title, breadcrumbLead, typePillLabel, typePillClass, breadcrumbSuffix, resultingBinding, cliPreview };
}

export type DomainProcessDrawerCopyInput = {
    mode: DrawerMode;
    sobject: string;
    processContext: ProcessContext;
    triggerOperation: TriggerOperation | '';
    domainMethodToken: string;
    /** Already the right label for either kind of scope — `"Created"`-style for a trigger family, or `"Domain Method Execution"` for that family — see `FAMILY_ITEMS` in `lib/bindingView.ts`. */
    familyLabel: string;
    type: 'Action' | 'Criteria';
    classToInject: string;
    order: string;
    developerName: string | undefined;
};

/** Builds the header/breadcrumb/CLI-preview copy for a Domain Process Bindings drawer. See canvas Turn 4 (4b create, 4c edit). The RESULTING BINDING sentence itself is unchanged — `BindingForm.svelte` already renders one matching 4b/4c's own shape. */
export function domainProcessDrawerCopy(input: DomainProcessDrawerCopyInput): Omit<DrawerCopy, 'resultingBinding'> {
    const { mode, sobject, processContext, triggerOperation, domainMethodToken, familyLabel, type, classToInject, order, developerName } = input;
    const isEdit = mode === 'edit';
    const title = `${isEdit ? 'Edit' : 'New'} domain process binding`;
    const breadcrumbLead = `${sobject} / ${familyLabel}`;
    const breadcrumbSuffix = isEdit ? '' : 'scope locked';

    const isTrigger = processContext !== 'DomainMethodExecution';
    const cliPreview = isEdit
        ? undefined
        : `domain-process-binding create --developer-name ${developerName?.trim() || '…'} --sobject ${sobject || '…'} --type ${type.toLowerCase()} --class-to-inject ${classToInject.trim() || '…'} --order ${order.trim() || '…'}` +
          (isTrigger ? cliFlag('trigger-operation', triggerOperation || undefined) : cliFlag('domain-method-token', domainMethodToken.trim() || undefined));

    return {
        title,
        breadcrumbLead,
        typePillLabel: type === 'Action' ? 'ACTION' : 'CRITERIA',
        typePillClass: type === 'Action' ? 'type-pill' : 'type-pill type-criteria',
        breadcrumbSuffix,
        cliPreview,
    };
}
