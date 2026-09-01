import type { Connection } from '@salesforce/core';
// `@simplysf/simply-aep-core` ships as an ESM-only package; this extension is bundled/loaded as
// CommonJS, so the value is imported dynamically (which `tsc` rejects as a static require of ESM),
// and the types need an explicit resolution-mode since they can't be inferred from a (nonexistent)
// static import. Same pattern `applicationFactoryCli.ts`/`at4dxCli.ts` already use — see docs/design/0006.
import type {
    At4dxPlatformEventSubscriptionCreateResult,
    At4dxPlatformEventSubscriptionUpdateResult,
    CreatePlatformEventSubscriptionInput,
    CreatePlatformEventSubscriptionTarget,
    MalformedPlatformEventSubscriptionRecord,
    PlatformEventDistributionInput,
    PlatformEventDistributionResult,
    PlatformEventSubscriptionIssue,
    PlatformEventSubscriptionIssueRule,
    PlatformEventSubscriptionRuleInfo,
    RawPlatformEventSubscriptionRecord,
    UpdatePlatformEventSubscriptionInput,
    UpdatePlatformEventSubscriptionTarget,
} from '@simplysf/simply-aep-core' with { 'resolution-mode': 'import' };
import { At4dxCliError, resolveConnection, type BindingSource } from './at4dxCli';
import { truncate, type Logger } from './logger';

export type { MalformedPlatformEventSubscriptionRecord, PlatformEventDistributionResult, PlatformEventSubscriptionIssue, RawPlatformEventSubscriptionRecord };
export type {
    CreatePlatformEventSubscriptionInput,
    MatcherRule,
    PlatformEventDistributionInput,
    PlatformEventDistributionMatch,
    PlatformEventDistributionMiss,
    PlatformEventDistributionMissReason,
    PlatformEventSubscriptionIssueRule,
    PlatformEventSubscriptionRuleInfo,
    UpdatePlatformEventSubscriptionInput,
} from '@simplysf/simply-aep-core' with { 'resolution-mode': 'import' };

export type PlatformEventSubscriptionScan = {
    records: RawPlatformEventSubscriptionRecord[];
    malformed: MalformedPlatformEventSubscriptionRecord[];
    issues: PlatformEventSubscriptionIssue[];
    /** `PLATFORM_EVENT_SUBSCRIPTION_RULES`, forwarded so the panel needs no import of an ESM-only package. */
    rules: Record<PlatformEventSubscriptionIssueRule, PlatformEventSubscriptionRuleInfo>;
};

/** Alias for `PlatformEventSubscriptionScan`'s `rules` shape, so callers need no second `resolution-mode` import. */
export type PlatformEventSubscriptionRules = PlatformEventSubscriptionScan['rules'];

/**
 * Reads AT4DX Platform Event Distributor subscriptions (`PlatformEvents_Subscription__mdt`) by
 * importing `@simplysf/simply-aep-core`'s scan/validate functions directly — same pattern
 * `getApplicationFactoryBindings`/`getDomainProcessBindings` use.
 *
 * Unlike `getDomainProcessBindings`, an empty result is **not** treated as "AT4DX isn't present": this
 * is an optional AT4DX family (a project can use the Trigger Action Framework and/or Application Factory
 * without ever configuring the Platform Event Distributor), matching `getFieldSetInclusions`'s posture
 * rather than the stricter one. See docs/design/0018.
 *
 * `eventBusFields` is intentionally never passed to `validatePlatformEventSubscriptions` — the library
 * has no scan that builds it (see docs/design/0018's deviation 2), so `non-conforming-event-bus` never
 * fires here rather than fabricating a conformance verdict this extension has no data to back.
 *
 * @param target - Whether to read from a connected org or local DX source directories.
 * @param logger - Optional sink for the "AT4DX Explorer" output channel (see 0002) — a summary line is
 *   always logged; verbose detail only when `simply-at4dx.debug` is on.
 * @returns The scanned records, plus the issues `validatePlatformEventSubscriptions` found and the rule
 *   metadata that explains them.
 * @throws {At4dxCliError} With a message safe to show the user directly.
 */
export async function getPlatformEventSubscriptions(target: BindingSource, logger?: Logger): Promise<PlatformEventSubscriptionScan> {
    const { scanLocalPlatformEventSubscriptions, scanOrgPlatformEventSubscriptions, validatePlatformEventSubscriptions, PLATFORM_EVENT_SUBSCRIPTION_RULES } = await import(
        '@simplysf/simply-aep-core'
    );

    const start = Date.now();
    const label = target.kind === 'org' ? `org ${target.username}` : `source ${target.dirs.join(', ')}`;
    const summary = (outcome: string): void =>
        logger?.log(`${new Date().toISOString()} platform event subscription list (${label}) — ${Date.now() - start}ms — ${outcome}`);
    logger?.log(`reading platform event subscriptions: ${label}`, { verbose: true });

    const logError = (error: unknown): void => {
        const err = error as Error;
        logger?.log(`error: ${truncate(err.stack ?? err.message ?? String(error))}`, { verbose: true });
    };

    let records: RawPlatformEventSubscriptionRecord[];
    let malformed: MalformedPlatformEventSubscriptionRecord[];
    if (target.kind === 'org') {
        let connection: Connection;
        try {
            connection = await resolveConnection(target.username);
        } catch (error) {
            logError(error);
            summary('auth failed');
            throw new At4dxCliError(`Failed to connect to the org: ${(error as Error).message}`, error);
        }

        let scanResult: Awaited<ReturnType<typeof scanOrgPlatformEventSubscriptions>>;
        try {
            scanResult = await scanOrgPlatformEventSubscriptions(connection);
        } catch (error) {
            logError(error);
            summary('org query failed');
            throw new At4dxCliError(`Failed to query platform event subscriptions from the org: ${(error as Error).message}`, error);
        }

        if (scanResult.missing) {
            summary('platform event subscription metadata type not detected');
            return { records: [], malformed: [], issues: [], rules: PLATFORM_EVENT_SUBSCRIPTION_RULES };
        }
        records = scanResult.records;
        malformed = scanResult.malformed;
    } else {
        try {
            ({ records, malformed } = scanLocalPlatformEventSubscriptions(target.dirs));
        } catch (error) {
            logError(error);
            summary('local scan failed');
            throw new At4dxCliError(`Failed to scan the project directory for platform event subscriptions: ${(error as Error).message}`, error);
        }
    }

    // Validate before any filtering — a scan-scoped rule (e.g. duplicate-consumer) gives wrong answers
    // if computed from an already-filtered slice. See simply-node's docs/design/0011.
    const issues = validatePlatformEventSubscriptions({ records, malformed });

    summary(`ok, ${records.length} record(s), ${issues.length} issue(s)`);
    return { records, malformed, issues, rules: PLATFORM_EVENT_SUBSCRIPTION_RULES };
}

/**
 * Simulates `PlatformEventDistributor`'s consumer resolution for one hypothetical event against
 * `records` — a thin async wrapper around the library's pure, synchronous `resolvePlatformEventDistribution`,
 * needed only because the webview can't import the ESM-only package directly (see docs/design/0018's
 * "match simulator" section: this needs no org round trip beyond the scan `records` already came from).
 */
export async function simulatePlatformEventDistribution(input: PlatformEventDistributionInput, records: RawPlatformEventSubscriptionRecord[]): Promise<PlatformEventDistributionResult> {
    const { resolvePlatformEventDistribution } = await import('@simplysf/simply-aep-core');
    return resolvePlatformEventDistribution(input, records);
}

/**
 * Outcome of `createSubscription`/`updateSubscription`: either the write (and, for an org target,
 * deploy) went through, or `validatePlatformEventSubscriptions` found an `error`-severity issue and the
 * library refused to write — not treated as a thrown failure, since the caller can retry with
 * `force: true`. Every other `PlatformEventSubscriptionWriteErrorCode` still throws {@link At4dxCliError}.
 */
export type PlatformEventSubscriptionWriteOutcome =
    | { kind: 'ok'; result: At4dxPlatformEventSubscriptionCreateResult | At4dxPlatformEventSubscriptionUpdateResult }
    | { kind: 'blocked'; issues: PlatformEventSubscriptionIssue[] };

/** Same dual-`@salesforce/core`-install cast `applicationFactoryCli.ts`'s own `asWriteConnection` documents, for `CreatePlatformEventSubscriptionTarget`/`UpdatePlatformEventSubscriptionTarget`. */
function asWriteConnection(connection: Connection): NonNullable<CreatePlatformEventSubscriptionTarget['connection']> {
    return connection as unknown as NonNullable<CreatePlatformEventSubscriptionTarget['connection']>;
}

async function resolveCreateTarget(target: BindingSource): Promise<CreatePlatformEventSubscriptionTarget> {
    return target.kind === 'org' ? { connection: asWriteConnection(await resolveConnection(target.username)) } : { sourceDir: target.dirs[0] };
}

async function resolveUpdateTarget(target: BindingSource): Promise<UpdatePlatformEventSubscriptionTarget> {
    return target.kind === 'org' ? { connection: asWriteConnection(await resolveConnection(target.username)) } : { sourceDirs: target.dirs };
}

/** `label`/`summary`/`logError` are identical shape across the read path above and the two write functions below — this is that shared setup, mirroring `applicationFactoryCli.ts`'s own `callLogging`. */
function callLogging(logger: Logger | undefined, kind: 'create' | 'update', target: BindingSource) {
    const start = Date.now();
    const label = target.kind === 'org' ? `org ${target.username}` : `source ${target.dirs.join(', ')}`;
    return {
        summary: (outcome: string): void =>
            logger?.log(`${new Date().toISOString()} platform event subscription ${kind} (${label}) — ${Date.now() - start}ms — ${outcome}`),
        logError: (error: unknown): void => {
            const err = error as Error;
            logger?.log(`error: ${truncate(err.stack ?? err.message ?? String(error))}`, { verbose: true });
        },
    };
}

/** Creates a new `PlatformEvents_Subscription__mdt` record against `target` — a local `.md-meta.xml` file or an org deploy. See docs/design/0018. */
export async function createSubscription(input: CreatePlatformEventSubscriptionInput, target: BindingSource, logger?: Logger): Promise<PlatformEventSubscriptionWriteOutcome> {
    const { createPlatformEventSubscription, PlatformEventSubscriptionWriteError } = await import('@simplysf/simply-aep-core');
    const { summary, logError } = callLogging(logger, 'create', target);
    logger?.log(`creating platform event subscription ${input.developerName}`, { verbose: true });

    try {
        const result = await createPlatformEventSubscription(input, await resolveCreateTarget(target));
        summary(`ok, ${result.issues.length} issue(s)`);
        return { kind: 'ok', result };
    } catch (error) {
        if (error instanceof PlatformEventSubscriptionWriteError && error.code === 'validation-failed') {
            summary('blocked by validation');
            return { kind: 'blocked', issues: error.issues ?? [] };
        }
        logError(error);
        summary('failed');
        throw new At4dxCliError(writeErrorMessage(error), error);
    }
}

/** Updates an existing `PlatformEvents_Subscription__mdt` record — located by `input.developerName`. Same blocked-vs-thrown contract as {@link createSubscription}. */
export async function updateSubscription(input: UpdatePlatformEventSubscriptionInput, target: BindingSource, logger?: Logger): Promise<PlatformEventSubscriptionWriteOutcome> {
    const { updatePlatformEventSubscription, PlatformEventSubscriptionWriteError } = await import('@simplysf/simply-aep-core');
    const { summary, logError } = callLogging(logger, 'update', target);
    logger?.log(`updating platform event subscription ${input.developerName}`, { verbose: true });

    try {
        const result = await updatePlatformEventSubscription(input, await resolveUpdateTarget(target));
        summary(`ok, ${result.issues.length} issue(s)`);
        return { kind: 'ok', result };
    } catch (error) {
        if (error instanceof PlatformEventSubscriptionWriteError && error.code === 'validation-failed') {
            summary('blocked by validation');
            return { kind: 'blocked', issues: error.issues ?? [] };
        }
        logError(error);
        summary('failed');
        throw new At4dxCliError(writeErrorMessage(error), error);
    }
}

/** `PlatformEventSubscriptionWriteError`'s own message is already safe to show; `deploy-failed` gets the same "nothing was saved" clarification every other write wrapper in this extension already adds. */
function writeErrorMessage(error: unknown): string {
    const err = error as Error & { code?: string };
    if (err.code === 'deploy-failed') {
        return `${err.message} The subscription was not written anywhere durable — nothing was saved to local source or left in the org.`;
    }
    return err.message ?? String(error);
}
