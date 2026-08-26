import { AuthInfo, Connection } from '@salesforce/core';
// `@simplysf/simply-aep-core` ships as an ESM-only package; this extension is bundled/loaded as
// CommonJS, so the value is imported dynamically (which `tsc` rejects as a static require of ESM),
// and the types need an explicit resolution-mode since they can't be inferred from a (nonexistent)
// static import. Same pattern this file previously used for `execa` — see docs/design/0006.
import type {
    DomainProcessBindingRow,
    RawDomainProcessBindingRecord,
} from '@simplysf/simply-aep-core' with { 'resolution-mode': 'import' };
import { redactProxyUrl, truncate, type Logger } from './logger';

export type { DomainProcessBindingRow };

export type BindingSource = { kind: 'org'; username: string } | { kind: 'source'; dirs: string[] };

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
 * @returns The resolved bindings.
 * @throws {At4dxCliError} With a message safe to show the user directly.
 */
export async function getDomainProcessBindings(target: BindingSource, sobjects?: string[], logger?: Logger): Promise<DomainProcessBindingRow[]> {
    const { scanLocalDomainProcessBindings, scanOrgDomainProcessBindings, resolveDomainProcessBindings } = await import('@simplysf/simply-aep-core');

    const start = Date.now();
    const label = target.kind === 'org' ? `org ${target.username}` : `source ${target.dirs.join(', ')}`;
    const summary = (outcome: string): void =>
        logger?.log(`${new Date().toISOString()} domain-process-binding list (${label}) — ${Date.now() - start}ms — ${outcome}`);
    logger?.log(`reading bindings: ${label}${sobjects?.length ? ` (sobjects: ${sobjects.join(', ')})` : ''}`, { verbose: true });

    const logError = (error: unknown): void => {
        const err = error as Error;
        logger?.log(`error: ${truncate(err.stack ?? err.message ?? String(error))}`, { verbose: true });
    };

    let records: RawDomainProcessBindingRecord[];
    if (target.kind === 'org') {
        logger?.log(
            `env: HTTPS_PROXY=${presence(process.env.HTTPS_PROXY)} HTTP_PROXY=${presence(process.env.HTTP_PROXY)} NO_PROXY=${presence(process.env.NO_PROXY)}`,
            { verbose: true },
        );

        let connection: Connection;
        try {
            const authInfo = await AuthInfo.create({ username: target.username });
            connection = await Connection.create({ authInfo });
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
        records = scanResult.records;
    } else {
        try {
            records = scanLocalDomainProcessBindings(target.dirs);
        } catch (error) {
            logError(error);
            summary('local scan failed');
            throw new At4dxCliError(`Failed to scan the project directory: ${(error as Error).message}`, error);
        }

        if (records.length === 0) {
            summary('at4dx not detected');
            throw new At4dxCliError(AT4DX_NOT_DETECTED_MESSAGE);
        }
    }

    const sobjectFilter = sobjects?.length ? new Set(sobjects) : undefined;
    const filteredRecords = sobjectFilter ? records.filter((record) => sobjectFilter.has(record.sobject)) : records;

    summary('ok');
    return resolveDomainProcessBindings(filteredRecords);
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
