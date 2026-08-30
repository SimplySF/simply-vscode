import { AuthInfo, Connection } from '@salesforce/core';
// `@simplysf/simply-aep-core` ships as an ESM-only package; this extension is bundled/loaded as
// CommonJS, so the value is imported dynamically (which `tsc` rejects as a static require of ESM),
// and the types need an explicit resolution-mode since they can't be inferred from a (nonexistent)
// static import. Same pattern this file previously used for `execa` — see docs/design/0006.
import type {
    At4dxDomainProcessBindingWriteResult,
    CreateDomainProcessBindingInput,
    CreateDomainProcessBindingTarget,
    DomainProcessBindingIssue,
    DomainProcessBindingIssueRule,
    DomainProcessBindingRow,
    DomainProcessBindingRuleInfo,
    DomainProcessLocalScanResult,
    SetDomainProcessBindingInput,
    SetDomainProcessBindingTarget,
} from '@simplysf/simply-aep-core' with { 'resolution-mode': 'import' };
import { redactProxyUrl, truncate, type Logger } from './logger';

export type { DomainProcessBindingIssue, DomainProcessBindingRow };
export type {
    CreateDomainProcessBindingInput,
    DomainProcessBindingSObjectField,
    DomainProcessType,
    ProcessContext,
    SetDomainProcessBindingInput,
    TriggerOperation,
} from '@simplysf/simply-aep-core' with { 'resolution-mode': 'import' };

export type DomainProcessBindingScan = {
    rows: DomainProcessBindingRow[];
    issues: DomainProcessBindingIssue[];
    /** `DOMAIN_PROCESS_BINDING_RULES`, forwarded so the panel needs no import of an ESM-only package. */
    rules: Record<DomainProcessBindingIssueRule, DomainProcessBindingRuleInfo>;
};

/** Alias for `DomainProcessBindingScan`'s `rules` shape, so callers need no second `resolution-mode` import. */
export type DomainProcessBindingRules = DomainProcessBindingScan['rules'];

export type BindingSource = { kind: 'org'; username: string } | { kind: 'source'; dirs: string[] };

/**
 * Outcome of `createBinding`/`setBinding`: either the write (and, for an org target, deploy) went
 * through, or `validateDomainProcessBindings` found an `error`-severity issue and the library refused
 * to write — not treated as a thrown failure, since the caller can retry with `force: true` rather than
 * having to recover from an exception. Every other `DomainProcessBindingWriteErrorCode` still throws
 * `At4dxCliError`, matching `getDomainProcessBindings`'s existing contract.
 */
export type WriteOutcome =
    | { kind: 'ok'; result: At4dxDomainProcessBindingWriteResult }
    | { kind: 'blocked'; issues: DomainProcessBindingIssue[] };

/** Thrown for any failure reading AT4DX bindings, with a message already safe to show the user directly. */
export class At4dxCliError extends Error {
    public constructor(
        message: string,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'At4dxCliError';
    }
}

/** Matches `simply-aep`'s own `error.at4dxNotDetected` message (see docs/design/0006). */
const AT4DX_NOT_DETECTED_MESSAGE =
    "AT4DX's Trigger Action Framework doesn't appear to be present in this source: the DomainProcessBinding__mdt Custom Metadata Type wasn't found.";

/**
 * Reads AT4DX Trigger Action Framework bindings by importing `@simplysf/simply-aep-core`'s scan and
 * resolve functions directly — the same logic `sf simply aep at4dx domain-process-binding list`
 * itself imports (see docs/design/0006), rather than shelling out to that command.
 *
 * @param target - Whether to read from a connected org or local DX source directories.
 * @param sobjects - Optional SObject API name filter, applied before resolution.
 * @param logger - Optional sink for the "AT4DX Domain Process Bindings" output channel (see 0002)
 *   — a summary line is always logged; verbose detail only when `simply-at4dx.debug` is on.
 * @returns The resolved bindings, plus the issues `validateDomainProcessBindings` found and the rule
 *   metadata that explains them.
 * @throws {At4dxCliError} With a message safe to show the user directly.
 */
export async function getDomainProcessBindings(
    target: BindingSource,
    sobjects?: string[],
    logger?: Logger,
): Promise<DomainProcessBindingScan> {
    const {
        scanLocalDomainProcessBindings,
        scanOrgDomainProcessBindings,
        resolveDomainProcessBindings,
        validateDomainProcessBindings,
        DOMAIN_PROCESS_BINDING_RULES,
    } = await import('@simplysf/simply-aep-core');

    const start = Date.now();
    const label = target.kind === 'org' ? `org ${target.username}` : `source ${target.dirs.join(', ')}`;
    const summary = (outcome: string): void =>
        logger?.log(`${new Date().toISOString()} domain-process-binding list (${label}) — ${Date.now() - start}ms — ${outcome}`);
    logger?.log(`reading bindings: ${label}${sobjects?.length ? ` (sobjects: ${sobjects.join(', ')})` : ''}`, { verbose: true });

    const logError = (error: unknown): void => {
        const err = error as Error;
        logger?.log(`error: ${truncate(err.stack ?? err.message ?? String(error))}`, { verbose: true });
    };

    let scan: DomainProcessLocalScanResult; // DomainProcessOrgScanResult structurally satisfies this
    if (target.kind === 'org') {
        logger?.log(
            `env: HTTPS_PROXY=${presence(process.env.HTTPS_PROXY)} HTTP_PROXY=${presence(process.env.HTTP_PROXY)} NO_PROXY=${presence(process.env.NO_PROXY)}`,
            { verbose: true },
        );

        let connection: Connection;
        try {
            connection = await resolveConnection(target.username);
        } catch (error) {
            logError(error);
            summary('auth failed');
            throw new At4dxCliError(`Failed to connect to the org: ${(error as Error).message}`, error);
        }

        let scanResult: Awaited<ReturnType<typeof scanOrgDomainProcessBindings>>;
        try {
            scanResult = await scanOrgDomainProcessBindings(connection);
        } catch (error) {
            logError(error);
            summary('org query failed');
            throw new At4dxCliError(`Failed to query bindings from the org: ${(error as Error).message}`, error);
        }

        if (scanResult.missing) {
            summary('at4dx not detected');
            throw new At4dxCliError(AT4DX_NOT_DETECTED_MESSAGE);
        }
        scan = scanResult;
    } else {
        try {
            scan = scanLocalDomainProcessBindings(target.dirs);
        } catch (error) {
            logError(error);
            summary('local scan failed');
            throw new At4dxCliError(`Failed to scan the project directory: ${(error as Error).message}`, error);
        }

        if (scan.records.length === 0 && scan.malformed.length === 0) {
            summary('at4dx not detected');
            throw new At4dxCliError(AT4DX_NOT_DETECTED_MESSAGE);
        }
    }

    // Validate before filtering — a scan-scoped rule (e.g. duplicate-developer-name) gives wrong
    // answers if computed from an already-filtered slice. See simply-node's docs/design/0011
    // (domain-process-binding-issue-scoping) — not this repo's own 0011, which is unrelated.
    const issues = validateDomainProcessBindings(scan);

    const sobjectFilter = sobjects?.length ? new Set(sobjects) : undefined;
    const filteredRecords = sobjectFilter ? scan.records.filter((record) => sobjectFilter.has(record.sobject)) : scan.records;

    summary(`ok, ${issues.length} issue(s)`);
    return { rows: resolveDomainProcessBindings(filteredRecords), issues, rules: DOMAIN_PROCESS_BINDING_RULES };
}

/**
 * Builds a `Connection` for `username` the same way for every call site that needs one — the read path
 * above, the two write functions below, and `applicationFactoryCli.ts`'s own read path. Throws the raw
 * `AuthInfo`/`Connection` error; callers wrap it into an `At4dxCliError` themselves so each can
 * log/summarize with its own context.
 */
export async function resolveConnection(username: string): Promise<Connection> {
    const authInfo = await AuthInfo.create({ username });
    return Connection.create({ authInfo });
}

/**
 * `simply-aep-core` depends on its own `@salesforce/core` (`^8.30.0`, currently resolving to `8.32.6`
 * in `node_modules/@simplysf/simply-aep-core/node_modules`) separately from this extension's own
 * (`^9.1.7`) — two different installed copies of the same package, a classic dual-package hazard. The
 * two `Connection` classes are structurally identical (this is the same `@salesforce/core` major-ish
 * line, and `scanOrgDomainProcessBindings`'s `AepConnection` — a `Pick` of just the methods it calls —
 * already accepts our v9 instance without complaint), but `CreateDomainProcessBindingTarget`/
 * `SetDomainProcessBindingTarget` type `connection` as the *full* class, so `tsc` sees two nominally
 * different classes (their private fields make them incompatible by declaration, even though neither
 * write path touches a private field itself). This cast is that one, deliberate escape hatch.
 */
function asWriteConnection(connection: Connection): NonNullable<CreateDomainProcessBindingTarget['connection']> {
    return connection as unknown as NonNullable<CreateDomainProcessBindingTarget['connection']>;
}

/** Resolves a `BindingSource` into the target shape `createDomainProcessBinding` expects. */
async function resolveCreateTarget(target: BindingSource): Promise<CreateDomainProcessBindingTarget> {
    return target.kind === 'org' ? { connection: asWriteConnection(await resolveConnection(target.username)) } : { sourceDir: target.dirs[0] };
}

/** Resolves a `BindingSource` into the target shape `setDomainProcessBinding` expects. */
async function resolveSetTarget(target: BindingSource): Promise<SetDomainProcessBindingTarget> {
    return target.kind === 'org' ? { connection: asWriteConnection(await resolveConnection(target.username)) } : { sourceDirs: target.dirs };
}

/** `label`/`summary`/`logError` are identical shape across `getDomainProcessBindings` and the two write functions below — this is that shared setup. */
function callLogging(logger: Logger | undefined, kind: 'create' | 'set', target: BindingSource) {
    const start = Date.now();
    const label = target.kind === 'org' ? `org ${target.username}` : `source ${target.dirs.join(', ')}`;
    return {
        summary: (outcome: string): void =>
            logger?.log(`${new Date().toISOString()} domain-process-binding ${kind} (${label}) — ${Date.now() - start}ms — ${outcome}`),
        logError: (error: unknown): void => {
            const err = error as Error;
            logger?.log(`error: ${truncate(err.stack ?? err.message ?? String(error))}`, { verbose: true });
        },
    };
}

/**
 * Creates a new `DomainProcessBinding__mdt` record against `target` — a local `.md-meta.xml` file or an
 * org deploy, matching whichever `BindingSource` produced the scan this write is happening from (see
 * docs/design/0009 for why this extension only ever resolves one, unlike the library's own
 * local-and-org-at-once support). A blocking validation issue is reported as `{ kind: 'blocked' }`
 * rather than thrown — the caller can offer a "Save Anyway" retry with `input.force: true` rather than
 * having to recover from an exception. Every other failure throws {@link At4dxCliError}.
 */
export async function createBinding(input: CreateDomainProcessBindingInput, target: BindingSource, logger?: Logger): Promise<WriteOutcome> {
    const { createDomainProcessBinding, DomainProcessBindingWriteError } = await import('@simplysf/simply-aep-core');
    const { summary, logError } = callLogging(logger, 'create', target);
    logger?.log(`creating binding ${input.developerName}`, { verbose: true });

    try {
        const result = await createDomainProcessBinding(input, await resolveCreateTarget(target));
        summary(`ok, ${result.issues.length} issue(s)`);
        return { kind: 'ok', result };
    } catch (error) {
        if (error instanceof DomainProcessBindingWriteError && error.code === 'validation-failed') {
            summary('blocked by validation');
            return { kind: 'blocked', issues: error.issues ?? [] };
        }
        logError(error);
        summary('failed');
        throw new At4dxCliError(writeErrorMessage(error), error);
    }
}

/**
 * Updates an existing `DomainProcessBinding__mdt` record — located by `input.developerName` — against
 * `target`. Same blocked-vs-thrown contract as {@link createBinding}.
 */
export async function setBinding(input: SetDomainProcessBindingInput, target: BindingSource, logger?: Logger): Promise<WriteOutcome> {
    const { setDomainProcessBinding, DomainProcessBindingWriteError } = await import('@simplysf/simply-aep-core');
    const { summary, logError } = callLogging(logger, 'set', target);
    logger?.log(`updating binding ${input.developerName}`, { verbose: true });

    try {
        const result = await setDomainProcessBinding(input, await resolveSetTarget(target));
        summary(`ok, ${result.issues.length} issue(s)`);
        return { kind: 'ok', result };
    } catch (error) {
        if (error instanceof DomainProcessBindingWriteError && error.code === 'validation-failed') {
            summary('blocked by validation');
            return { kind: 'blocked', issues: error.issues ?? [] };
        }
        logError(error);
        summary('failed');
        throw new At4dxCliError(writeErrorMessage(error), error);
    }
}

/**
 * `DomainProcessBindingWriteError`'s own message is already written to be shown directly (it's what
 * `simply-aep`'s CLI commands print as-is) — this only handles the one case that needs extra context: a
 * deploy failure after an org-only write means nothing durable was kept (the write happens in a temp
 * directory `simply-aep-core` manages and removes itself), unlike a local-source write, which is safely
 * on disk regardless of what a *later* deploy step does.
 */
function writeErrorMessage(error: unknown): string {
    const err = error as Error & { code?: string };
    if (err.code === 'deploy-failed') {
        return `${err.message} The binding was not written anywhere durable — nothing was saved to local source or left in the org.`;
    }
    return err.message ?? String(error);
}

function presence(value: string | undefined): string {
    if (!value) {
        return 'not set';
    }
    try {
        return redactProxyUrl(value);
    } catch {
        return 'set';
    }
}
