import type { Connection } from '@salesforce/core';
// `@simplysf/simply-aep-core` ships as an ESM-only package; this extension is bundled/loaded as
// CommonJS, so the value is imported dynamically (which `tsc` rejects as a static require of ESM),
// and the types need an explicit resolution-mode since they can't be inferred from a (nonexistent)
// static import. Same pattern `at4dxCli.ts` already uses — see docs/design/0006.
import type {
    At4dxBindingCreateResult,
    At4dxBindingRow,
    At4dxBindingUpdateResult,
    At4dxFieldSetInclusionCreateResult,
    At4dxFieldSetInclusionUpdateResult,
    BindingIssue,
    BindingIssueRule,
    BindingRuleInfo,
    BindingType,
    CreateBindingInput,
    CreateBindingTarget,
    CreateFieldSetInclusionInput,
    CreateFieldSetInclusionTarget,
    FieldSetInclusionIssue,
    FieldSetInclusionIssueRule,
    FieldSetInclusionLocalScanResult,
    FieldSetInclusionRuleInfo,
    LocalScanResult,
    RawFieldSetInclusionRecord,
    UpdateBindingInput,
    UpdateBindingTarget,
    UpdateFieldSetInclusionInput,
    UpdateFieldSetInclusionTarget,
} from '@simplysf/simply-aep-core' with { 'resolution-mode': 'import' };
import { At4dxCliError, resolveConnection, type BindingSource } from './at4dxCli';
import { truncate, type Logger } from './logger';

export type { At4dxBindingRow, BindingIssue, FieldSetInclusionIssue, RawFieldSetInclusionRecord };
export type {
    BindingIssueRule,
    BindingKeyField,
    BindingRuleInfo,
    BindingType,
    CreateBindingInput,
    CreateFieldSetInclusionInput,
    FieldSetInclusionIssueRule,
    FieldSetInclusionRuleInfo,
    FieldSetInclusionSObjectField,
    UpdateBindingInput,
    UpdateFieldSetInclusionInput,
    WritableBindingType,
} from '@simplysf/simply-aep-core' with { 'resolution-mode': 'import' };

export type ApplicationFactoryScan = {
    rows: At4dxBindingRow[];
    issues: BindingIssue[];
    /** `BINDING_RULES`, forwarded so the panel needs no import of an ESM-only package. */
    rules: Record<BindingIssueRule, BindingRuleInfo>;
    /** `ENTITY_DEFINITION_STANDARD_OBJECTS`, sorted and forwarded for `BindingSObjectField.svelte`'s eligibility check — a `Set` doesn't survive `JSON.stringify`. Fetched alongside the scan since it's only ever needed once the Application Factory tab has already been opened. */
    standardObjects: string[];
};

/** Alias for `ApplicationFactoryScan`'s `rules` shape, so callers need no second `resolution-mode` import. */
export type ApplicationFactoryRules = ApplicationFactoryScan['rules'];

/** Matches `simply-aep`'s own `error.at4dxNotDetected`-style message — see `at4dxCli.ts`'s `AT4DX_NOT_DETECTED_MESSAGE` for the Domain Process equivalent. */
const APPLICATION_FACTORY_NOT_DETECTED_MESSAGE =
    "AT4DX's Application Factory doesn't appear to be present in this source: none of the ApplicationFactory_*Binding__mdt Custom Metadata Types were found.";

/**
 * Reads AT4DX Application Factory bindings (Service/Selector/Domain/UnitOfWork) by importing
 * `@simplysf/simply-aep-core`'s scan/resolve/validate functions directly, the same pattern
 * `getDomainProcessBindings` uses (see docs/design/0006 and 0016).
 *
 * Unlike `getDomainProcessBindings`, an empty result here is **not** treated as "AT4DX isn't
 * present" — a project can legitimately use one half of AT4DX (Trigger Action Framework vs.
 * Application Factory) without the other. The one exception is an org reporting every requested
 * Custom Metadata Type as missing, which is a real "not present" signal.
 *
 * @param target - Whether to read from a connected org or local DX source directories.
 * @param logger - Optional sink for the "AT4DX Explorer" output channel (see 0002) — a summary line
 *   is always logged; verbose detail only when `simply-at4dx.debug` is on.
 * @returns The resolved bindings, plus the issues `validateBindings` found and the rule metadata
 *   that explains them.
 * @throws {At4dxCliError} With a message safe to show the user directly.
 */
export async function getApplicationFactoryBindings(target: BindingSource, logger?: Logger): Promise<ApplicationFactoryScan> {
    const { scanLocalBindings, scanOrgBindings, resolveBindings, validateBindings, ALL_BINDING_TYPES, BINDING_RULES, ENTITY_DEFINITION_STANDARD_OBJECTS } =
        await import('@simplysf/simply-aep-core');

    const start = Date.now();
    const label = target.kind === 'org' ? `org ${target.username}` : `source ${target.dirs.join(', ')}`;
    const summary = (outcome: string): void =>
        logger?.log(`${new Date().toISOString()} binding list (${label}) — ${Date.now() - start}ms — ${outcome}`);
    logger?.log(`reading application factory bindings: ${label}`, { verbose: true });

    const logError = (error: unknown): void => {
        const err = error as Error;
        logger?.log(`error: ${truncate(err.stack ?? err.message ?? String(error))}`, { verbose: true });
    };

    let scan: Pick<LocalScanResult, 'records' | 'malformed' | 'ambiguous'>;
    if (target.kind === 'org') {
        let connection: Connection;
        try {
            connection = await resolveConnection(target.username);
        } catch (error) {
            logError(error);
            summary('auth failed');
            throw new At4dxCliError(`Failed to connect to the org: ${(error as Error).message}`, error);
        }

        let scanResult: Awaited<ReturnType<typeof scanOrgBindings>>;
        try {
            scanResult = await scanOrgBindings(connection, ALL_BINDING_TYPES);
        } catch (error) {
            logError(error);
            summary('org query failed');
            throw new At4dxCliError(`Failed to query Application Factory bindings from the org: ${(error as Error).message}`, error);
        }

        if (scanResult.missingTypes.length === ALL_BINDING_TYPES.length) {
            summary('at4dx application factory not detected');
            throw new At4dxCliError(APPLICATION_FACTORY_NOT_DETECTED_MESSAGE);
        }
        scan = scanResult;
    } else {
        try {
            scan = scanLocalBindings(target.dirs, ALL_BINDING_TYPES);
        } catch (error) {
            logError(error);
            summary('local scan failed');
            throw new At4dxCliError(`Failed to scan the project directory for Application Factory bindings: ${(error as Error).message}`, error);
        }
    }

    // Validate before any filtering — a scan-scoped rule (e.g. duplicate-developer-name) gives wrong
    // answers if computed from an already-filtered slice. See simply-node's docs/design/0011
    // (domain-process-binding-issue-scoping) — not this repo's own 0011, which is unrelated.
    const issues = validateBindings(scan);

    summary(`ok, ${scan.records.length} record(s), ${issues.length} issue(s)`);
    return {
        rows: resolveBindings(scan.records),
        issues,
        rules: BINDING_RULES,
        standardObjects: [...ENTITY_DEFINITION_STANDARD_OBJECTS].sort((a, b) => a.localeCompare(b)),
    };
}

/**
 * `AT4DX_BINDING_LOCAL_OBJECT_NAMES[bindingType]`, forwarded so the host can build the
 * `openApplicationFactoryIssue` local-file-search glob — `<localObjectName>.<developerName>.md-meta.xml` —
 * without importing the ESM-only package itself.
 */
export async function applicationFactoryLocalObjectName(bindingType: BindingType): Promise<string> {
    const { AT4DX_BINDING_LOCAL_OBJECT_NAMES } = await import('@simplysf/simply-aep-core');
    return AT4DX_BINDING_LOCAL_OBJECT_NAMES[bindingType];
}

export type FieldSetInclusionScan = {
    records: RawFieldSetInclusionRecord[];
    issues: FieldSetInclusionIssue[];
    /** `FIELD_SET_INCLUSION_RULES`, forwarded so the panel needs no import of an ESM-only package. */
    rules: Record<FieldSetInclusionIssueRule, FieldSetInclusionRuleInfo>;
};

/**
 * Reads `SelectorConfig_FieldSetInclusion__mdt` records (stage 4 — see docs/design/0017's Stage 4).
 * Same "empty isn't necessarily missing" reasoning as {@link getApplicationFactoryBindings}: a project
 * can have Selector bindings with no field set inclusions configured at all. An org target *does* carry
 * a real "the Custom Metadata Type doesn't exist here" signal (`scanOrgFieldSetInclusions`'s own
 * `missing` flag); local source has no equivalent, so only the org path can throw "not detected."
 *
 * @param target - Whether to read from a connected org or local DX source directories.
 * @param logger - Optional sink for the "AT4DX Explorer" output channel — a summary line is always
 *   logged; verbose detail only when `simply-at4dx.debug` is on.
 * @throws {At4dxCliError} With a message safe to show the user directly.
 */
export async function getFieldSetInclusions(target: BindingSource, logger?: Logger): Promise<FieldSetInclusionScan> {
    const { scanLocalFieldSetInclusions, scanOrgFieldSetInclusions, validateFieldSetInclusions, FIELD_SET_INCLUSION_RULES } = await import('@simplysf/simply-aep-core');

    const start = Date.now();
    const label = target.kind === 'org' ? `org ${target.username}` : `source ${target.dirs.join(', ')}`;
    const summary = (outcome: string): void =>
        logger?.log(`${new Date().toISOString()} field set inclusion list (${label}) — ${Date.now() - start}ms — ${outcome}`);
    logger?.log(`reading field set inclusions: ${label}`, { verbose: true });

    const logError = (error: unknown): void => {
        const err = error as Error;
        logger?.log(`error: ${truncate(err.stack ?? err.message ?? String(error))}`, { verbose: true });
    };

    let scan: Pick<FieldSetInclusionLocalScanResult, 'records' | 'malformed' | 'ambiguous'>;
    if (target.kind === 'org') {
        let connection: Connection;
        try {
            connection = await resolveConnection(target.username);
        } catch (error) {
            logError(error);
            summary('auth failed');
            throw new At4dxCliError(`Failed to connect to the org: ${(error as Error).message}`, error);
        }

        let scanResult: Awaited<ReturnType<typeof scanOrgFieldSetInclusions>>;
        try {
            scanResult = await scanOrgFieldSetInclusions(connection);
        } catch (error) {
            logError(error);
            summary('org query failed');
            throw new At4dxCliError(`Failed to query field set inclusions from the org: ${(error as Error).message}`, error);
        }

        if (scanResult.missing) {
            summary('field set inclusion metadata type not detected');
            return { records: [], issues: [], rules: FIELD_SET_INCLUSION_RULES };
        }
        scan = scanResult;
    } else {
        try {
            scan = scanLocalFieldSetInclusions(target.dirs);
        } catch (error) {
            logError(error);
            summary('local scan failed');
            throw new At4dxCliError(`Failed to scan the project directory for field set inclusions: ${(error as Error).message}`, error);
        }
    }

    const issues = validateFieldSetInclusions(scan);
    summary(`ok, ${scan.records.length} record(s), ${issues.length} issue(s)`);
    return { records: scan.records, issues, rules: FIELD_SET_INCLUSION_RULES };
}

/**
 * Outcome of `createApplicationFactoryBinding`/`updateApplicationFactoryBinding`: either the write (and,
 * for an org target, deploy) went through, or `validateBindings` found an `error`-severity issue and the
 * library refused to write — not treated as a thrown failure, since the caller can retry with
 * `force: true` rather than having to recover from an exception. Every other `BindingWriteErrorCode`
 * still throws {@link At4dxCliError}, matching `at4dxCli.ts`'s `WriteOutcome` contract for Domain
 * Process bindings — kept as a separate type since the two wrap different library result shapes.
 */
export type ApplicationFactoryWriteOutcome =
    | { kind: 'ok'; result: At4dxBindingCreateResult | At4dxBindingUpdateResult }
    | { kind: 'blocked'; issues: BindingIssue[] };

/**
 * `at4dxCli.ts`'s `asWriteConnection` cast, duplicated rather than exported generic: same dual-
 * `@salesforce/core`-install hazard (see that function's own comment for the full explanation), but a
 * different target type (`CreateBindingTarget`/`UpdateBindingTarget` instead of
 * `CreateDomainProcessBindingTarget`/`SetDomainProcessBindingTarget`) makes a shared generic signature
 * looser than either call site needs.
 */
function asWriteConnection(connection: Connection): NonNullable<CreateBindingTarget['connection']> {
    return connection as unknown as NonNullable<CreateBindingTarget['connection']>;
}

async function resolveCreateTarget(target: BindingSource): Promise<CreateBindingTarget> {
    return target.kind === 'org' ? { connection: asWriteConnection(await resolveConnection(target.username)) } : { sourceDir: target.dirs[0] };
}

async function resolveUpdateTarget(target: BindingSource): Promise<UpdateBindingTarget> {
    return target.kind === 'org' ? { connection: asWriteConnection(await resolveConnection(target.username)) } : { sourceDirs: target.dirs };
}

/** `label`/`summary`/`logError` are identical shape across every write function below — shared setup, mirroring `at4dxCli.ts`'s own `callLogging`. */
function callLogging(logger: Logger | undefined, kind: 'create' | 'update', target: BindingSource) {
    const start = Date.now();
    const label = target.kind === 'org' ? `org ${target.username}` : `source ${target.dirs.join(', ')}`;
    return {
        summary: (outcome: string): void =>
            logger?.log(`${new Date().toISOString()} application factory binding ${kind} (${label}) — ${Date.now() - start}ms — ${outcome}`),
        logError: (error: unknown): void => {
            const err = error as Error;
            logger?.log(`error: ${truncate(err.stack ?? err.message ?? String(error))}`, { verbose: true });
        },
    };
}

/**
 * Creates a new Application Factory binding record (Service/Selector/Domain in stage 2; UnitOfWork in
 * stage 3) against `target` — a local `.md-meta.xml` file or an org deploy. See docs/design/0016.
 */
export async function createApplicationFactoryBinding(input: CreateBindingInput, target: BindingSource, logger?: Logger): Promise<ApplicationFactoryWriteOutcome> {
    const { createBinding, BindingWriteError } = await import('@simplysf/simply-aep-core');
    const { summary, logError } = callLogging(logger, 'create', target);
    logger?.log(`creating ${input.bindingType} binding ${input.developerName}`, { verbose: true });

    try {
        const result = await createBinding(input, await resolveCreateTarget(target));
        summary(`ok, ${result.issues.length} issue(s)`);
        return { kind: 'ok', result };
    } catch (error) {
        if (error instanceof BindingWriteError && error.code === 'validation-failed') {
            summary('blocked by validation');
            return { kind: 'blocked', issues: error.issues ?? [] };
        }
        logError(error);
        if ((error as Error & { code?: string }).code === 'type-field-mismatch') {
            logger?.log(`offending input: ${JSON.stringify(input)}`, { verbose: true });
        }
        summary('failed');
        throw new At4dxCliError(writeErrorMessage(error), error);
    }
}

/** Updates an existing Application Factory binding record — located by `input.developerName` within `input.bindingType`. Same blocked-vs-thrown contract as {@link createApplicationFactoryBinding}. */
export async function updateApplicationFactoryBinding(input: UpdateBindingInput, target: BindingSource, logger?: Logger): Promise<ApplicationFactoryWriteOutcome> {
    const { updateBinding, BindingWriteError } = await import('@simplysf/simply-aep-core');
    const { summary, logError } = callLogging(logger, 'update', target);
    logger?.log(`updating ${input.bindingType} binding ${input.developerName}`, { verbose: true });

    try {
        const result = await updateBinding(input, await resolveUpdateTarget(target));
        summary(`ok, ${result.issues.length} issue(s)`);
        return { kind: 'ok', result };
    } catch (error) {
        if (error instanceof BindingWriteError && error.code === 'validation-failed') {
            summary('blocked by validation');
            return { kind: 'blocked', issues: error.issues ?? [] };
        }
        logError(error);
        if ((error as Error & { code?: string }).code === 'type-field-mismatch') {
            logger?.log(`offending input: ${JSON.stringify(input)}`, { verbose: true });
        }
        summary('failed');
        throw new At4dxCliError(writeErrorMessage(error), error);
    }
}

/** `at4dxWrite.ts`'s `asWriteConnection`, duplicated for `CreateFieldSetInclusionTarget`/`UpdateFieldSetInclusionTarget` — same reasoning as {@link asWriteConnection} above: a different target type makes a shared generic looser than either call site needs. */
function asFieldSetInclusionWriteConnection(connection: Connection): NonNullable<CreateFieldSetInclusionTarget['connection']> {
    return connection as unknown as NonNullable<CreateFieldSetInclusionTarget['connection']>;
}

async function resolveCreateFieldSetInclusionTarget(target: BindingSource): Promise<CreateFieldSetInclusionTarget> {
    return target.kind === 'org' ? { connection: asFieldSetInclusionWriteConnection(await resolveConnection(target.username)) } : { sourceDir: target.dirs[0] };
}

async function resolveUpdateFieldSetInclusionTarget(target: BindingSource): Promise<UpdateFieldSetInclusionTarget> {
    return target.kind === 'org' ? { connection: asFieldSetInclusionWriteConnection(await resolveConnection(target.username)) } : { sourceDirs: target.dirs };
}

/**
 * Outcome of `createSelectorFieldSetInclusion`/`updateSelectorFieldSetInclusion` — same blocked-vs-thrown
 * contract as {@link ApplicationFactoryWriteOutcome}, over `FieldSetInclusionWriteError` instead.
 */
export type FieldSetInclusionWriteOutcome =
    | { kind: 'ok'; result: At4dxFieldSetInclusionCreateResult | At4dxFieldSetInclusionUpdateResult }
    | { kind: 'blocked'; issues: FieldSetInclusionIssue[] };

/**
 * Creates a new `SelectorConfig_FieldSetInclusion__mdt` record (stage 4 — see docs/design/0017's Stage
 * 4). Unlike a binding write, this never triggers a full panel re-render — see
 * `at4dxExplorerPanel.ts`'s `submitFieldSetInclusion`, which updates the still-open Selector drawer in
 * place instead, so adding a field set doesn't close whatever else the user was in the middle of editing.
 */
export async function createSelectorFieldSetInclusion(input: CreateFieldSetInclusionInput, target: BindingSource, logger?: Logger): Promise<FieldSetInclusionWriteOutcome> {
    const { createFieldSetInclusion, FieldSetInclusionWriteError } = await import('@simplysf/simply-aep-core');
    const start = Date.now();
    const label = target.kind === 'org' ? `org ${target.username}` : `source ${target.dirs.join(', ')}`;
    logger?.log(`creating field set inclusion ${input.developerName}`, { verbose: true });

    try {
        const result = await createFieldSetInclusion(input, await resolveCreateFieldSetInclusionTarget(target));
        logger?.log(`${new Date().toISOString()} field set inclusion create (${label}) — ${Date.now() - start}ms — ok, ${result.issues.length} issue(s)`);
        return { kind: 'ok', result };
    } catch (error) {
        if (error instanceof FieldSetInclusionWriteError && error.code === 'validation-failed') {
            logger?.log(`${new Date().toISOString()} field set inclusion create (${label}) — ${Date.now() - start}ms — blocked by validation`);
            return { kind: 'blocked', issues: error.issues ?? [] };
        }
        const err = error as Error;
        logger?.log(`error: ${truncate(err.stack ?? err.message ?? String(error))}`, { verbose: true });
        logger?.log(`${new Date().toISOString()} field set inclusion create (${label}) — ${Date.now() - start}ms — failed`);
        throw new At4dxCliError(fieldSetInclusionWriteErrorMessage(error), error);
    }
}

/** Updates an existing `SelectorConfig_FieldSetInclusion__mdt` record — located by `input.developerName`. Toggling `isActive: false` is how the drawer's own "✕ remove" affordance works (the library has no delete — see docs/design/0017's deviations). Same in-place-update contract as {@link createSelectorFieldSetInclusion}. */
export async function updateSelectorFieldSetInclusion(input: UpdateFieldSetInclusionInput, target: BindingSource, logger?: Logger): Promise<FieldSetInclusionWriteOutcome> {
    const { updateFieldSetInclusion, FieldSetInclusionWriteError } = await import('@simplysf/simply-aep-core');
    const start = Date.now();
    const label = target.kind === 'org' ? `org ${target.username}` : `source ${target.dirs.join(', ')}`;
    logger?.log(`updating field set inclusion ${input.developerName}`, { verbose: true });

    try {
        const result = await updateFieldSetInclusion(input, await resolveUpdateFieldSetInclusionTarget(target));
        logger?.log(`${new Date().toISOString()} field set inclusion update (${label}) — ${Date.now() - start}ms — ok, ${result.issues.length} issue(s)`);
        return { kind: 'ok', result };
    } catch (error) {
        if (error instanceof FieldSetInclusionWriteError && error.code === 'validation-failed') {
            logger?.log(`${new Date().toISOString()} field set inclusion update (${label}) — ${Date.now() - start}ms — blocked by validation`);
            return { kind: 'blocked', issues: error.issues ?? [] };
        }
        const err = error as Error;
        logger?.log(`error: ${truncate(err.stack ?? err.message ?? String(error))}`, { verbose: true });
        logger?.log(`${new Date().toISOString()} field set inclusion update (${label}) — ${Date.now() - start}ms — failed`);
        throw new At4dxCliError(fieldSetInclusionWriteErrorMessage(error), error);
    }
}

/** Same shape as {@link writeErrorMessage} — `FieldSetInclusionWriteError`'s own message is already safe to show, `type-field-mismatch` doesn't apply here (there's only one type), `deploy-failed` gets the same "nothing was saved" clarification. */
function fieldSetInclusionWriteErrorMessage(error: unknown): string {
    const err = error as Error & { code?: string };
    if (err.code === 'deploy-failed') {
        return `${err.message} The field set inclusion was not written anywhere durable — nothing was saved to local source or left in the org.`;
    }
    return err.message ?? String(error);
}

/**
 * `BindingWriteError`'s own message is already written to be shown directly, with one exception:
 * `type-field-mismatch` means the *webview sent a field the binding type doesn't have* — a bug in the
 * form, not something the user did wrong, so it gets its own generic copy rather than surfacing
 * validation-speak like "priority cannot be set when bindingType is Domain or UnitOfWork" to the user.
 * The caller logs the offending input verbosely so the actual mismatch is still recoverable from the
 * output channel. Also handles `deploy-failed` the same way `at4dxCli.ts`'s `writeErrorMessage` does.
 */
function writeErrorMessage(error: unknown): string {
    const err = error as Error & { code?: string };
    if (err.code === 'type-field-mismatch') {
        return "Internal error: the form sent a field this binding type doesn't support. Please report this as a bug.";
    }
    if (err.code === 'deploy-failed') {
        return `${err.message} The binding was not written anywhere durable — nothing was saved to local source or left in the org.`;
    }
    return err.message ?? String(error);
}
