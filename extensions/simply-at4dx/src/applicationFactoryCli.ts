import type { Connection } from '@salesforce/core';
// `@simplysf/simply-aep-core` ships as an ESM-only package; this extension is bundled/loaded as
// CommonJS, so the value is imported dynamically (which `tsc` rejects as a static require of ESM),
// and the types need an explicit resolution-mode since they can't be inferred from a (nonexistent)
// static import. Same pattern `at4dxCli.ts` already uses — see docs/design/0006.
import type {
    At4dxBindingRow,
    BindingIssue,
    BindingIssueRule,
    BindingRuleInfo,
    BindingType,
    LocalScanResult,
} from '@simplysf/simply-aep-core' with { 'resolution-mode': 'import' };
import { At4dxCliError, resolveConnection, type BindingSource } from './at4dxCli';
import { truncate, type Logger } from './logger';

export type { At4dxBindingRow, BindingIssue };
export type { BindingIssueRule, BindingKeyField, BindingRuleInfo, BindingType } from '@simplysf/simply-aep-core' with { 'resolution-mode': 'import' };

export type ApplicationFactoryScan = {
    rows: At4dxBindingRow[];
    issues: BindingIssue[];
    /** `BINDING_RULES`, forwarded so the panel needs no import of an ESM-only package. */
    rules: Record<BindingIssueRule, BindingRuleInfo>;
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
    const { scanLocalBindings, scanOrgBindings, resolveBindings, validateBindings, ALL_BINDING_TYPES, BINDING_RULES } = await import(
        '@simplysf/simply-aep-core'
    );

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
    return { rows: resolveBindings(scan.records), issues, rules: BINDING_RULES };
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
