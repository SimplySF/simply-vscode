// `execa` ships as an ESM-only package; this extension is bundled/loaded as CommonJS, so the value is
// imported dynamically (which `tsc` rejects as a static require of ESM), and the type needs an
// explicit resolution-mode since it can't be inferred from a (nonexistent) static import.
import type { ExecaError } from 'execa' with { 'resolution-mode': 'import' };
import { baseCommand, redactProxyUrl, truncate, type Logger } from './logger';

/** Mirrors `DomainProcessType` from `@simplysf/simply-aep`'s `at4dxDomainProcessBindingTypes.ts`. */
export type DomainProcessType = 'Action' | 'Criteria';

/** Mirrors `ProcessContext` from `@simplysf/simply-aep`. */
export type ProcessContext = 'TriggerExecution' | 'DomainMethodExecution';

/** Mirrors `TriggerOperation` from `@simplysf/simply-aep`. */
export type TriggerOperation =
    | 'Before_Insert'
    | 'After_Insert'
    | 'Before_Update'
    | 'After_Update'
    | 'Before_Delete'
    | 'After_Delete'
    | 'After_Undelete';

/**
 * Mirrors `DomainProcessBindingRow` from `@simplysf/simply-aep`'s `at4dxDomainProcessBindingTypes.ts`
 * — the shape `sf simply aep at4dx domain-process-binding list --json` returns. Duplicated here as a
 * type-only mirror rather than an npm dependency on `simply-aep`, since this extension only ever
 * consumes its JSON output over stdout, never its code.
 */
export type DomainProcessBindingRow = {
    developerName: string;
    sobject: string;
    processContext: ProcessContext;
    triggerOperation?: TriggerOperation;
    domainMethodToken?: string;
    type: DomainProcessType;
    classToInject: string;
    order: number;
    isActive: boolean;
    executeAsynchronous: boolean;
    logicalInverse: boolean;
    preventRecursive: boolean;
    description?: string;
    source: string;
    orderCollision?: boolean;
};

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

/** The `sf --json` envelope shape. `result`/`message` are typed optional rather than as a discriminated union on `status`, since oclif's failure status isn't a fixed literal TS can narrow on. */
type OclifJsonResult<T> = { status: number; result?: T; message?: string };

/** @returns A user-facing message for a failed `sf` invocation, recognizing the "plugin not installed" case specifically. */
function describeCliFailure(stderr: string): string {
    if (/command .*not found|is not a sf command/i.test(stderr)) {
        return 'The `simply-aep` plugin isn\'t installed. Run `sf plugins install @simplysf/simply-aep` and try again.';
    }
    return stderr.trim() || 'The `sf` command failed with no output.';
}

/**
 * Reads AT4DX Trigger Action Framework bindings by shelling out to
 * `sf simply aep at4dx domain-process-binding list --json`.
 *
 * @param cwd - The directory to run `sf` from (a workspace folder).
 * @param target - Whether to read from a connected org or local DX source directories.
 * @param sobjects - Optional SObject API name filter.
 * @param logger - Optional sink for the "AT4DX Domain Process Bindings" output channel (see 0002)
 *   — a summary line is always logged; full args/env/output only when `simply-at4dx.debug` is on.
 * @returns The resolved bindings.
 * @throws {At4dxCliError} With a message safe to show the user directly.
 */
export async function getDomainProcessBindings(
    cwd: string,
    target: BindingSource,
    sobjects?: string[],
    logger?: Logger,
): Promise<DomainProcessBindingRow[]> {
    const args = ['simply', 'aep', 'at4dx', 'domain-process-binding', 'list', '--json'];
    if (target.kind === 'org') {
        args.push('--target-org', target.username);
    } else {
        for (const dir of target.dirs) {
            args.push('--source-dir', dir);
        }
    }
    for (const sobject of sobjects ?? []) {
        args.push('--sobject', sobject);
    }

    const start = Date.now();
    const summary = (outcome: string): void => logger?.log(`${new Date().toISOString()} ${baseCommand(args)} — ${Date.now() - start}ms — ${outcome}`);
    logger?.log(`spawning: sf ${args.join(' ')} (cwd=${cwd})`, { verbose: true });
    logger?.log(`env: HTTPS_PROXY=${presence(process.env.HTTPS_PROXY)} HTTP_PROXY=${presence(process.env.HTTP_PROXY)} NO_PROXY=${presence(process.env.NO_PROXY)}`, {
        verbose: true,
    });

    let stdout: string;
    try {
        const { execa } = await import('execa');
        stdout = (
            await execa('sf', args, {
                cwd,
                maxBuffer: 10 * 1024 * 1024,
                // `sf` should never need input; closing stdin turns a stray interactive prompt (e.g. a
                // CLI first-run prompt) into an immediate EOF instead of a silent, indefinite hang —
                // there's no TTY in the extension host for anyone to answer it.
                stdin: 'ignore',
                timeout: 30_000,
                env: { SF_AUTOUPDATE_DISABLE: 'true', SF_DISABLE_TELEMETRY: 'true' },
            })
        ).stdout as string;
        logger?.log(`stdout: ${truncate(stdout)}`, { verbose: true });
    } catch (error) {
        const execError = error as ExecaError;
        logger?.log(`stdout: ${truncate((execError.stdout as string | undefined) ?? '')}`, { verbose: true });
        logger?.log(`stderr: ${truncate((execError.stderr as string | undefined) ?? '')}`, { verbose: true });

        if (execError.code === 'ENOENT') {
            summary('sf not found');
            throw new At4dxCliError(
                'The Salesforce CLI (`sf`) was not found on your PATH. Install it from https://developer.salesforce.com/tools/salesforcecli.',
                error,
            );
        }
        if (execError.timedOut) {
            summary('timed out');
            throw new At4dxCliError(
                'The `sf` command timed out after 30s. It may be waiting on a first-run prompt — try running `sf simply aep at4dx domain-process-binding list --json` directly in a terminal once, then retry.',
                error,
            );
        }
        // oclif commands still print the --json envelope to stdout on a thrown CLI error; only fall
        // back to stderr when there's no parseable envelope to read the real message from.
        if (!execError.stdout) {
            summary(`exited ${execError.exitCode ?? '?'}`);
            throw new At4dxCliError(describeCliFailure((execError.stderr as string | undefined) ?? execError.message ?? ''), error);
        }
        stdout = execError.stdout as string;
    }

    let envelope: OclifJsonResult<{ source: string; bindings: DomainProcessBindingRow[] }>;
    try {
        envelope = JSON.parse(stdout) as typeof envelope;
    } catch (error) {
        summary('bad JSON');
        throw new At4dxCliError('Could not parse `sf` command output as JSON.', error);
    }

    if (envelope.status !== 0 || !envelope.result) {
        summary('cli error');
        throw new At4dxCliError(envelope.message ?? 'The `sf` command failed with no error message.');
    }

    summary('ok');
    return envelope.result.bindings;
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
