import * as vscode from 'vscode';

/**
 * Small logging seam so `at4dxCli.ts` doesn't need to import `vscode` directly — keeps the
 * CLI-shelling logic decoupled from extension-host glue, same call made for `BindingSource`/
 * `At4dxCliError` in that file.
 */
export type Logger = {
    /** `verbose: true` lines are only written when the `simply-at4dx.debug` setting is on; omitted/false always writes. */
    log(message: string, opts?: { verbose?: boolean }): void;
};

const MAX_LOG_LENGTH = 20_000;

/** Truncates long captured output before it's written to the channel. */
export function truncate(value: string): string {
    return value.length > MAX_LOG_LENGTH ? `${value.slice(0, MAX_LOG_LENGTH)}\n…(truncated)` : value;
}

/**
 * Strips embedded credentials (`user:pass@`) from a proxy URL before it's ever logged, even in
 * debug mode — `HTTPS_PROXY`/`HTTP_PROXY` can legitimately contain them.
 */
export function redactProxyUrl(value: string): string {
    return value.replace(/^(https?:\/\/)[^@/]+@/i, '$1');
}

export function createOutputChannelLogger(channel: vscode.OutputChannel): Logger {
    return {
        log(message, opts) {
            if (opts?.verbose && !vscode.workspace.getConfiguration('simply-at4dx').get<boolean>('debug', false)) {
                return;
            }
            channel.appendLine(message);
        },
    };
}
