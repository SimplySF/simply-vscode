import * as vscode from 'vscode';
import {
    At4dxCliError,
    createBinding,
    getDomainProcessBindings,
    setBinding,
    type BindingSource,
    type CreateDomainProcessBindingInput,
    type DomainProcessBindingIssue,
    type DomainProcessBindingRow,
    type DomainProcessBindingRules,
    type DomainProcessType,
    type ProcessContext,
    type SetDomainProcessBindingInput,
    type TriggerOperation,
} from './at4dxCli';
import type { Logger } from './logger';

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

/**
 * State the panel can be in. `data` embeds every fetched row and every issue
 * `validateDomainProcessBindings` found — SObject/operation-family selection, and the issue
 * summary/badges/section that go with it, all happen entirely client-side from there, no round trip
 * back to the extension host, since nothing about "show a different already-fetched slice" needs
 * anything only the host can do.
 */
type DataState = {
    kind: 'data';
    rows: DomainProcessBindingRow[];
    issues: DomainProcessBindingIssue[];
    rules: DomainProcessBindingRules;
    /** What a create/edit submitted from this render writes to — see docs/design/0009. */
    target: BindingSource;
};

type PanelState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'empty' } | DataState;

/**
 * The create/edit form's field values as the webview posts them on submit — see docs/design/0009. The
 * form is always fully populated (from either the toolbar's current selection or the row being edited),
 * so unlike `simply-aep-core`'s CLI-facing `set` semantics (only passed flags change), every field here
 * is always present; there's no partial-update case to represent.
 */
type BindingFormPayload = {
    developerName: string;
    label: string;
    sobject: string;
    sobjectAlternate: boolean;
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
    description: string;
};

/**
 * `</script>`-safe embed of a value as JS source (not parsed as JSON): escaping `<` as a unicode escape
 * stays valid JS while stopping the HTML parser from ever seeing something that looks like a closing
 * `</script>` tag inside embedded data (e.g. a `Description__c` or an issue `message`).
 *
 * Also escapes U+2028/U+2029 (LINE SEPARATOR / PARAGRAPH SEPARATOR): `JSON.stringify` emits both raw
 * inside a string — valid JSON, since neither is `"`/`\`/a control character — but both are Unicode
 * line terminators, and older/stricter JS parsing contexts treat a raw line terminator inside a string
 * literal as ending the statement rather than continuing the string, throwing a generic
 * "Invalid or unexpected token"/"Invalid regular expression" syntax error partway through whatever
 * followed. A `Description__c` (free text — the one field here a user actually types, including
 * pasting from a source that introduces these) is exactly the field that would carry one in. ES2019
 * made this legal inside a normal `<script>`'s own parse, but this HTML is handed to VS Code's webview
 * host, which reconstructs the document via its own `document.write` — a different, apparently
 * stricter parsing path this doesn't benefit from. Exported for `embedJsonInScript.test.ts`.
 */
export function embedJsonInScript(value: unknown): string {
    // The escape targets below are built from character codes, not written as escape-sequence
    // literals in this file's own source: a prior version of this fix wrote them as regex literals,
    // which round-tripped through some tooling in the chain back into the literal raw U+2028/U+2029
    // character sitting right here in the source file — exactly the hazard this function exists to
    // escape *out* of the embedded data, only now baked into the extension's own compiled output
    // instead. Character-code construction can't suffer that round trip.
    const backslash = String.fromCharCode(0x5c);
    const escapeChar = (code: number): string => `${backslash}u${code.toString(16).padStart(4, '0')}`;
    const lineSeparator = String.fromCharCode(0x2028);
    const paragraphSeparator = String.fromCharCode(0x2029);
    return JSON.stringify(value)
        .split('<')
        .join(escapeChar(0x3c))
        .split(lineSeparator)
        .join(escapeChar(0x2028))
        .split(paragraphSeparator)
        .join(escapeChar(0x2029));
}

/** A short display form of a `BindingSource` for the explorer tab strip — see docs/design/0014. */
function sourceLabel(target: BindingSource): string {
    if (target.kind === 'org') {
        return target.username;
    }
    return target.dirs.map((dir) => vscode.workspace.asRelativePath(dir, false)).join(', ');
}

/** The webview-side mirror of `PanelState` — see `src/webview/types.ts`'s `InitialState`, which this must stay in sync with. */
function toInitialState(state: PanelState): unknown {
    switch (state.kind) {
        case 'loading':
            return { kind: 'loading' };
        case 'error':
            return { kind: 'error', message: state.message };
        case 'empty':
            return { kind: 'empty' };
        case 'data':
            return {
                kind: 'data',
                rows: state.rows,
                issues: state.issues,
                rules: state.rules,
                isLocalScan: state.target.kind === 'source',
                sourceLabel: sourceLabel(state.target),
            };
    }
}

/**
 * The panel's HTML shell — a mount point, the scan's state embedded as `window.__INITIAL_STATE__`, and
 * the compiled Svelte bundle (`dist/webview.js`, see docs/design/0011 and `esbuild.js`) that renders it.
 * All layout/markup lives in `src/webview/`'s components now; this file only builds the state the
 * webview needs and handles the messages it posts back.
 */
function buildShellHtml(state: PanelState, nonce: string, webviewJsUri: vscode.Uri): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    window.__INITIAL_STATE__ = ${embedJsonInScript(toInitialState(state))};
  </script>
  <script nonce="${nonce}" src="${webviewJsUri}"></script>
</body>
</html>`;
}

/** Opens/updates the "AT4DX Domain Process Bindings" webview panel. */
export class DomainProcessBindingPanel {
    private static currentPanel: DomainProcessBindingPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly webviewJsUri: vscode.Uri;
    private readonly disposables: vscode.Disposable[] = [];
    private state: PanelState = { kind: 'loading' };
    private logger: Logger | undefined;

    /**
     * Opens the panel (or reveals/resets an existing one) showing its loading state. `logger` is kept
     * for the lifetime of the panel instance — a create/edit's write call and the rescan that follows a
     * successful one (see `submitBinding` below) both happen entirely from inside the panel, not via a
     * round trip back through `extension.ts`, so the panel needs its own reference rather than being
     * handed one per call the way the initial scan is.
     */
    public static open(logger: Logger, extensionUri: vscode.Uri): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (DomainProcessBindingPanel.currentPanel) {
            DomainProcessBindingPanel.currentPanel.logger = logger;
            DomainProcessBindingPanel.currentPanel.panel.reveal(column);
            DomainProcessBindingPanel.currentPanel.render({ kind: 'loading' });
            return;
        }

        const panel = vscode.window.createWebviewPanel('simplyAt4dxDomainProcessBindings', 'AT4DX Explorer', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
        });
        DomainProcessBindingPanel.currentPanel = new DomainProcessBindingPanel(panel, logger, extensionUri);
    }

    public static setData(rows: DomainProcessBindingRow[], issues: DomainProcessBindingIssue[], rules: DomainProcessBindingRules, target: BindingSource): void {
        DomainProcessBindingPanel.currentPanel?.render({ kind: 'data', rows, issues, rules, target });
    }

    public static showError(message: string): void {
        DomainProcessBindingPanel.currentPanel?.render({ kind: 'error', message });
    }

    public static showEmpty(): void {
        DomainProcessBindingPanel.currentPanel?.render({ kind: 'empty' });
    }

    private constructor(panel: vscode.WebviewPanel, logger: Logger, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.logger = logger;
        this.webviewJsUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
        this.panel.title = 'AT4DX Explorer';
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (message: {
                command: string;
                classToInject?: string;
                index?: number;
                mode?: 'create' | 'edit';
                input?: BindingFormPayload;
                force?: boolean;
            }) => {
                if (message.command === 'openClass' && message.classToInject) {
                    void openApexClass(message.classToInject);
                } else if (message.command === 'openIssue' && typeof message.index === 'number') {
                    void this.openIssue(message.index);
                } else if (message.command === 'submitBinding' && message.mode && message.input) {
                    void this.submitBinding(message.mode, message.input, Boolean(message.force));
                }
            },
            null,
            this.disposables,
        );
        this.render({ kind: 'loading' });
    }

    private async openIssue(index: number): Promise<void> {
        if (this.state.kind !== 'data') {
            return;
        }
        const issue = this.state.issues[index];
        if (issue) {
            await openBindingFile(issue);
        }
    }

    /**
     * Handles the webview's `submitBinding` message (see docs/design/0009): writes against whatever
     * `BindingSource` produced the current scan, then either re-scans and re-renders the whole panel
     * (a write that went through — the freshest way to reflect it, and how the panel already renders
     * every other state change) or posts a targeted message back so the still-open form can show a
     * blocking issue or an error without losing what the user typed.
     */
    private async submitBinding(mode: 'create' | 'edit', input: BindingFormPayload, force: boolean): Promise<void> {
        if (this.state.kind !== 'data') {
            return;
        }
        const target = this.state.target;

        try {
            const outcome =
                mode === 'create'
                    ? await createBinding({ ...(input as CreateDomainProcessBindingInput), force }, target, this.logger)
                    : await setBinding({ ...(input as SetDomainProcessBindingInput), force }, target, this.logger);

            if (outcome.kind === 'blocked') {
                void this.panel.webview.postMessage({ command: 'writeBlocked', issues: outcome.issues });
                return;
            }

            const { rows, issues, rules } = await getDomainProcessBindings(target, undefined, this.logger);
            if (rows.length === 0 && issues.length === 0) {
                this.render({ kind: 'empty' });
                return;
            }
            this.render({ kind: 'data', rows, issues, rules, target });
        } catch (error) {
            void this.panel.webview.postMessage({ command: 'writeError', message: formatWriteError(error) });
        }
    }

    private render(state: PanelState): void {
        this.state = state;
        this.panel.webview.html = buildShellHtml(state, getNonce(), this.webviewJsUri);
    }

    private dispose(): void {
        DomainProcessBindingPanel.currentPanel = undefined;
        this.panel.dispose();
        let disposable: vscode.Disposable | undefined;
        while ((disposable = this.disposables.pop())) {
            disposable.dispose();
        }
    }
}

/** Mirrors `extension.ts`'s `errorMessage` — kept separate rather than shared since `at4dxCli.ts` deliberately has no `vscode` dependency (see `logger.ts`) and this is the only other call site that needs the same debug-hint copy. */
function formatWriteError(error: unknown): string {
    const message = error instanceof At4dxCliError ? error.message : `Unexpected error writing the binding: ${(error as Error).message}`;
    const debugHint = vscode.workspace.getConfiguration('simply-at4dx').get<boolean>('debug', false)
        ? 'See the "AT4DX Domain Process Bindings" output channel for the full command and captured output.'
        : 'See the "AT4DX Domain Process Bindings" output channel for details, or enable the simply-at4dx.debug setting and retry for the full command and captured output.';
    return `${message}\n\n${debugHint}`;
}

async function openApexClass(className: string): Promise<void> {
    const files = await vscode.workspace.findFiles(`**/${className}.cls`, '**/node_modules/**', 1);
    if (files.length === 0) {
        void vscode.window.showWarningMessage(`Could not find ${className}.cls in this workspace.`);
        return;
    }
    const document = await vscode.workspace.openTextDocument(files[0]);
    await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}

/**
 * Opens the `.md-meta.xml` a `DomainProcessBindingIssue` was found in, beside the panel — the host
 * looks up `filePath` from its own copy of the issue rather than trusting whatever the webview posts
 * back, since a filesystem path from a webview message would otherwise be a needless trust step.
 */
async function openBindingFile(issue: DomainProcessBindingIssue): Promise<void> {
    let uri: vscode.Uri | undefined;
    if (issue.filePath) {
        uri = vscode.Uri.file(issue.filePath);
    } else if (issue.developerName) {
        const files = await vscode.workspace.findFiles(
            `**/DomainProcessBinding.${issue.developerName}.md-meta.xml`,
            '**/node_modules/**',
            1,
        );
        uri = files[0];
    }
    if (!uri) {
        void vscode.window.showWarningMessage(`Could not find the metadata file for ${issue.developerName ?? 'this issue'}.`);
        return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}
