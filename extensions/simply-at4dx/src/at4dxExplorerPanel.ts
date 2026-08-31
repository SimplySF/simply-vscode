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
import {
    applicationFactoryLocalObjectName,
    createApplicationFactoryBinding,
    getApplicationFactoryBindings,
    updateApplicationFactoryBinding,
    type ApplicationFactoryRules,
    type At4dxBindingRow,
    type BindingIssue,
    type CreateBindingInput,
    type UpdateBindingInput,
} from './applicationFactoryCli';
import type { Logger } from './logger';

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

type ExplorerKey = 'domainProcess' | 'applicationFactory';

type DomainProcessData = {
    rows: DomainProcessBindingRow[];
    issues: DomainProcessBindingIssue[];
    rules: DomainProcessBindingRules;
};

type ApplicationFactoryData = {
    rows: At4dxBindingRow[];
    issues: BindingIssue[];
    rules: ApplicationFactoryRules;
    standardObjects: string[];
};

/**
 * The Application Factory create/edit form's field values as posted on submit (stage 2
 * Service/Selector/Domain, stage 3 UnitOfWork — see docs/design/0016). Fields vary by `bindingType`:
 * the form builds this from a per-type whitelist itself (see `ApplicationFactoryForm.svelte`), so
 * whichever fields aren't relevant to `bindingType` are simply absent rather than sent as `undefined`.
 */
type ApplicationFactoryFormPayload = {
    bindingType: 'Service' | 'Selector' | 'Domain' | 'UnitOfWork';
    developerName: string;
    label?: string;
    /** Required for Service/Selector/Domain; never sent for UnitOfWork, which has no `To__c` field. */
    to?: string;
    bindingInterface?: string;
    sobject?: string;
    sobjectAlternate?: boolean;
    priority?: number;
    /** UnitOfWork only — commit order. */
    sequence?: number;
};

/** One explorer's own slice of panel state. */
type ExplorerState<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'empty' } | ({ kind: 'data' } & T);

/** One `UnitOfWork` binding's new `BindingSequence__c`, as the SObject Bindings sheet's drag-and-drop posts it — see docs/design/0017's Stage 3 and `lib/dragReorder.ts`'s `PendingChange`. `sobject` isn't part of the write itself (the record is located by `developerName`) — it's echoed back in `SequenceBatchResult` so the sheet can report failures by the name the user actually recognizes on a card. */
type SequenceBatchUpdate = { developerName: string; sobject: string; sequence: number };

/**
 * The outcome of a `submitSequenceBatch` — how many of the pending moves actually saved (out of how many
 * were staged), and, if the batch stopped early, which SObject failed and why; anything past that point
 * was never attempted. Attached to exactly one render (see `render`'s `extra` parameter) rather than
 * persisted on `PanelState`, so it surfaces once in the freshly-mounted sheet and is gone on the next
 * unrelated re-render.
 */
type SequenceBatchResult = { savedCount: number; totalCount: number; failed?: { sobject: string; message: string } };

/**
 * The whole panel's state: which tab is active, plus each explorer's own independently-scanned data —
 * see docs/design/0016. `target` is panel-level (both explorers read the same `BindingSource`), known as
 * soon as `extension.ts`'s `pickBindingSource` resolves, well before either explorer has scanned
 * anything.
 */
type PanelState = {
    active: ExplorerKey;
    domainProcess: ExplorerState<DomainProcessData>;
    applicationFactory: ExplorerState<ApplicationFactoryData>;
    target?: BindingSource;
};

function initialPanelState(): PanelState {
    return { active: 'domainProcess', domainProcess: { kind: 'loading' }, applicationFactory: { kind: 'loading' } };
}

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

/** The webview-side mirror of `PanelState` — see `src/webview/types.ts`'s `InitialState`, which this must stay in sync with. `extra` carries one-render-only fields (see `render`'s own comment) that never make it into persisted `PanelState`. */
function toInitialState(state: PanelState, extra?: { lastBatchResult?: SequenceBatchResult }): unknown {
    return {
        active: state.active,
        domainProcess: state.domainProcess,
        applicationFactory: state.applicationFactory,
        isLocalScan: state.target ? state.target.kind === 'source' : undefined,
        sourceLabel: state.target ? sourceLabel(state.target) : undefined,
        lastBatchResult: extra?.lastBatchResult,
    };
}

/**
 * The panel's HTML shell — a mount point, the scan's state embedded as `window.__INITIAL_STATE__`, and
 * the compiled Svelte bundle (`dist/webview.js`, see docs/design/0011 and `esbuild.js`) that renders it.
 * All layout/markup lives in `src/webview/`'s components now; this file only builds the state the
 * webview needs and handles the messages it posts back.
 */
function buildShellHtml(state: PanelState, nonce: string, webviewJsUri: vscode.Uri, extra?: { lastBatchResult?: SequenceBatchResult }): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    window.__INITIAL_STATE__ = ${embedJsonInScript(toInitialState(state, extra))};
  </script>
  <script nonce="${nonce}" src="${webviewJsUri}"></script>
</body>
</html>`;
}

/** Opens/updates the "AT4DX Explorer" webview panel — Domain Process bindings and, since docs/design/0016, Application Factory bindings, as two tabs sharing one panel and one `BindingSource`. */
export class At4dxExplorerPanel {
    private static currentPanel: At4dxExplorerPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly webviewJsUri: vscode.Uri;
    private readonly disposables: vscode.Disposable[] = [];
    private state: PanelState = initialPanelState();
    private logger: Logger | undefined;

    /**
     * Opens the panel (or reveals/resets an existing one) showing its loading state. `logger` is kept
     * for the lifetime of the panel instance — a create/edit's write call and the rescan that follows a
     * successful one (see `submitBinding` below), and the Application Factory tab's own lazy scan (see
     * `selectExplorer`), all happen entirely from inside the panel, not via a round trip back through
     * `extension.ts`, so the panel needs its own reference rather than being handed one per call the way
     * the initial scan is.
     */
    public static open(logger: Logger, extensionUri: vscode.Uri): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (At4dxExplorerPanel.currentPanel) {
            At4dxExplorerPanel.currentPanel.logger = logger;
            At4dxExplorerPanel.currentPanel.panel.reveal(column);
            At4dxExplorerPanel.currentPanel.render(initialPanelState());
            return;
        }

        const panel = vscode.window.createWebviewPanel('simplyAt4dxDomainProcessBindings', 'AT4DX Explorer', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
        });
        At4dxExplorerPanel.currentPanel = new At4dxExplorerPanel(panel, logger, extensionUri);
    }

    /** Sets the Domain Process explorer's data — the result of `extension.ts`'s initial scan. */
    public static setData(rows: DomainProcessBindingRow[], issues: DomainProcessBindingIssue[], rules: DomainProcessBindingRules, target: BindingSource): void {
        const current = At4dxExplorerPanel.currentPanel;
        if (!current) {
            return;
        }
        current.state.target = target;
        current.render({ ...current.state, domainProcess: { kind: 'data', rows, issues, rules } });
    }

    public static showError(message: string): void {
        const current = At4dxExplorerPanel.currentPanel;
        if (!current) {
            return;
        }
        current.render({ ...current.state, domainProcess: { kind: 'error', message } });
    }

    public static showEmpty(): void {
        const current = At4dxExplorerPanel.currentPanel;
        if (!current) {
            return;
        }
        current.render({ ...current.state, domainProcess: { kind: 'empty' } });
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
                input?: BindingFormPayload | ApplicationFactoryFormPayload;
                force?: boolean;
                explorer?: ExplorerKey;
                updates?: SequenceBatchUpdate[];
            }) => {
                if (message.command === 'openClass' && message.classToInject) {
                    void openApexClass(message.classToInject);
                } else if (message.command === 'openIssue' && typeof message.index === 'number') {
                    void this.openIssue(message.index);
                } else if (message.command === 'openApplicationFactoryIssue' && typeof message.index === 'number') {
                    void this.openApplicationFactoryIssue(message.index);
                } else if (message.command === 'submitBinding' && message.mode && message.input) {
                    void this.submitBinding(message.mode, message.input as BindingFormPayload, Boolean(message.force));
                } else if (message.command === 'submitApplicationFactoryBinding' && message.mode && message.input) {
                    void this.submitApplicationFactoryBinding(message.mode, message.input as ApplicationFactoryFormPayload, Boolean(message.force));
                } else if (message.command === 'selectExplorer' && message.explorer) {
                    void this.selectExplorer(message.explorer);
                } else if (message.command === 'submitSequenceBatch' && Array.isArray(message.updates)) {
                    void this.submitSequenceBatch(message.updates);
                }
            },
            null,
            this.disposables,
        );
        this.render(this.state);
    }

    private async openIssue(index: number): Promise<void> {
        if (this.state.domainProcess.kind !== 'data') {
            return;
        }
        const issue = this.state.domainProcess.issues[index];
        if (issue) {
            await openBindingFile(issue);
        }
    }

    private async openApplicationFactoryIssue(index: number): Promise<void> {
        if (this.state.applicationFactory.kind !== 'data') {
            return;
        }
        const issue = this.state.applicationFactory.issues[index];
        if (issue) {
            await openApplicationFactoryBindingFile(issue);
        }
    }

    /**
     * Switches the active tab. The Application Factory explorer scans lazily — the first switch to it
     * triggers `getApplicationFactoryBindings` and re-renders when that resolves; switching back and
     * forth afterward just flips `active` against already-scanned data, no repeat org round trip. See
     * docs/design/0016.
     */
    private async selectExplorer(explorer: ExplorerKey): Promise<void> {
        this.state.active = explorer;

        if (explorer === 'applicationFactory' && this.state.applicationFactory.kind === 'loading' && this.state.target) {
            const target = this.state.target;
            this.render(this.state);
            try {
                const { rows, issues, rules, standardObjects } = await getApplicationFactoryBindings(target, this.logger);
                this.state.applicationFactory =
                    rows.length === 0 && issues.length === 0 ? { kind: 'empty' } : { kind: 'data', rows, issues, rules, standardObjects };
            } catch (error) {
                this.state.applicationFactory = { kind: 'error', message: formatReadError(error, 'reading Application Factory bindings') };
            }
        }
        this.render(this.state);
    }

    /**
     * Handles the webview's `submitBinding` message (see docs/design/0009): writes against whatever
     * `BindingSource` produced the current scan, then either re-scans and re-renders the whole panel
     * (a write that went through — the freshest way to reflect it, and how the panel already renders
     * every other state change) or posts a targeted message back so the still-open form can show a
     * blocking issue or an error without losing what the user typed.
     */
    private async submitBinding(mode: 'create' | 'edit', input: BindingFormPayload, force: boolean): Promise<void> {
        if (this.state.domainProcess.kind !== 'data' || !this.state.target) {
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
            const domainProcess: ExplorerState<DomainProcessData> = rows.length === 0 && issues.length === 0 ? { kind: 'empty' } : { kind: 'data', rows, issues, rules };
            this.render({ ...this.state, domainProcess });
        } catch (error) {
            void this.panel.webview.postMessage({ command: 'writeError', message: formatWriteError(error) });
        }
    }

    /**
     * Handles the webview's `submitApplicationFactoryBinding` message (stage 2 — see docs/design/0016).
     * Same write-then-rescan-the-whole-explorer contract as `submitBinding`, against
     * `createApplicationFactoryBinding`/`updateApplicationFactoryBinding` instead.
     */
    private async submitApplicationFactoryBinding(mode: 'create' | 'edit', input: ApplicationFactoryFormPayload, force: boolean): Promise<void> {
        if (this.state.applicationFactory.kind !== 'data' || !this.state.target) {
            return;
        }
        const target = this.state.target;

        try {
            const outcome =
                mode === 'create'
                    ? await createApplicationFactoryBinding({ ...(input as CreateBindingInput), force }, target, this.logger)
                    : await updateApplicationFactoryBinding({ ...(input as UpdateBindingInput), force }, target, this.logger);

            if (outcome.kind === 'blocked') {
                void this.panel.webview.postMessage({ command: 'writeBlocked', issues: outcome.issues });
                return;
            }

            const { rows, issues, rules, standardObjects } = await getApplicationFactoryBindings(target, this.logger);
            const applicationFactory: ExplorerState<ApplicationFactoryData> =
                rows.length === 0 && issues.length === 0 ? { kind: 'empty' } : { kind: 'data', rows, issues, rules, standardObjects };
            this.render({ ...this.state, applicationFactory });
        } catch (error) {
            void this.panel.webview.postMessage({ command: 'writeError', message: formatWriteError(error) });
        }
    }

    /**
     * Handles the webview's `submitSequenceBatch` message — the SObject Bindings sheet's "Save commit
     * order" bar (Stage 3, docs/design/0017). Writes each pending Unit of Work sequence change
     * sequentially, stopping at the first one that fails or is blocked (a batch of independent writes has
     * no atomic "all or nothing" — see the design doc's own reasoning for why this is a per-card status,
     * not a single all-or-nothing dialog). Whatever *did* save is reflected by one rescan-and-render at
     * the end, same as every other write; `lastBatchResult` rides along on that one render only (see
     * `render`'s `extra` parameter) so the freshly-mounted sheet can report what happened without it
     * lingering on a later, unrelated re-render.
     */
    private async submitSequenceBatch(updates: SequenceBatchUpdate[]): Promise<void> {
        if (this.state.applicationFactory.kind !== 'data' || !this.state.target) {
            return;
        }
        const target = this.state.target;

        let savedCount = 0;
        let failed: SequenceBatchResult['failed'];
        for (const update of updates) {
            try {
                const outcome = await updateApplicationFactoryBinding({ bindingType: 'UnitOfWork', developerName: update.developerName, sequence: update.sequence }, target, this.logger);
                if (outcome.kind === 'blocked') {
                    failed = { sobject: update.sobject, message: outcome.issues.map((issue) => issue.message).join(' ') || 'Blocked by validation.' };
                    break;
                }
                savedCount++;
            } catch (error) {
                failed = { sobject: update.sobject, message: formatWriteError(error) };
                break;
            }
        }

        try {
            const { rows, issues, rules, standardObjects } = await getApplicationFactoryBindings(target, this.logger);
            const applicationFactory: ExplorerState<ApplicationFactoryData> =
                rows.length === 0 && issues.length === 0 ? { kind: 'empty' } : { kind: 'data', rows, issues, rules, standardObjects };
            this.render({ ...this.state, applicationFactory }, { lastBatchResult: { savedCount, totalCount: updates.length, failed } });
        } catch (error) {
            void this.panel.webview.postMessage({ command: 'writeError', message: formatReadError(error, 'reading Application Factory bindings') });
        }
    }

    private render(state: PanelState, extra?: { lastBatchResult?: SequenceBatchResult }): void {
        this.state = state;
        this.panel.webview.html = buildShellHtml(state, getNonce(), this.webviewJsUri, extra);
    }

    private dispose(): void {
        At4dxExplorerPanel.currentPanel = undefined;
        this.panel.dispose();
        let disposable: vscode.Disposable | undefined;
        while ((disposable = this.disposables.pop())) {
            disposable.dispose();
        }
    }
}

/** Shared by `formatWriteError` and `selectExplorer`'s scan-failure path — same debug-hint copy, different lead message. */
function formatError(message: string): string {
    const debugHint = vscode.workspace.getConfiguration('simply-at4dx').get<boolean>('debug', false)
        ? 'See the "AT4DX Explorer" output channel for the full command and captured output.'
        : 'See the "AT4DX Explorer" output channel for details, or enable the simply-at4dx.debug setting and retry for the full command and captured output.';
    return `${message}\n\n${debugHint}`;
}

function formatWriteError(error: unknown): string {
    const message = error instanceof At4dxCliError ? error.message : `Unexpected error writing the binding: ${(error as Error).message}`;
    return formatError(message);
}

function formatReadError(error: unknown, action: string): string {
    const message = error instanceof At4dxCliError ? error.message : `Unexpected error ${action}: ${(error as Error).message}`;
    return formatError(message);
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

/** Same shape as `openBindingFile`, for an Application Factory `BindingIssue` — the local file name is keyed by `bindingType` rather than a single fixed object name. See docs/design/0016. */
async function openApplicationFactoryBindingFile(issue: BindingIssue): Promise<void> {
    let uri: vscode.Uri | undefined;
    if (issue.filePath) {
        uri = vscode.Uri.file(issue.filePath);
    } else if (issue.developerName) {
        const localObjectName = await applicationFactoryLocalObjectName(issue.bindingType);
        const files = await vscode.workspace.findFiles(`**/${localObjectName}.${issue.developerName}.md-meta.xml`, '**/node_modules/**', 1);
        uri = files[0];
    }
    if (!uri) {
        void vscode.window.showWarningMessage(`Could not find the metadata file for ${issue.developerName ?? 'this issue'}.`);
        return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}
