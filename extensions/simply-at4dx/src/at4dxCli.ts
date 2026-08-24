import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
 * @returns The resolved bindings.
 * @throws {At4dxCliError} With a message safe to show the user directly.
 */
export async function getDomainProcessBindings(
    cwd: string,
    target: BindingSource,
    sobjects?: string[],
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

    let stdout: string;
    try {
        ({ stdout } = await execFileAsync('sf', args, { cwd, maxBuffer: 10 * 1024 * 1024 }));
    } catch (error) {
        const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        if (execError.code === 'ENOENT') {
            throw new At4dxCliError(
                'The Salesforce CLI (`sf`) was not found on your PATH. Install it from https://developer.salesforce.com/tools/salesforcecli.',
                error,
            );
        }
        // oclif commands still print the --json envelope to stdout on a thrown CLI error; only fall
        // back to stderr when there's no parseable envelope to read the real message from.
        if (!execError.stdout) {
            throw new At4dxCliError(describeCliFailure(execError.stderr ?? execError.message), error);
        }
        stdout = execError.stdout;
    }

    let envelope: OclifJsonResult<{ source: string; bindings: DomainProcessBindingRow[] }>;
    try {
        envelope = JSON.parse(stdout) as typeof envelope;
    } catch (error) {
        throw new At4dxCliError('Could not parse `sf` command output as JSON.', error);
    }

    if (envelope.status !== 0 || !envelope.result) {
        throw new At4dxCliError(envelope.message ?? 'The `sf` command failed with no error message.');
    }

    return envelope.result.bindings;
}
