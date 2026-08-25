import * as vscode from 'vscode';
import { At4dxCliError, getDomainProcessBindings, type BindingSource } from './at4dxCli';
import { DomainProcessBindingPanel } from './domainProcessBindingPanel';
import { createOutputChannelLogger, type Logger } from './logger';

export function activate(context: vscode.ExtensionContext): void {
    const outputChannel = vscode.window.createOutputChannel('AT4DX Domain Process Bindings');
    const logger = createOutputChannelLogger(outputChannel);
    context.subscriptions.push(
        outputChannel,
        vscode.commands.registerCommand('simply-at4dx.showDomainProcessBindings', () => {
            void showDomainProcessBindings(logger);
        }),
    );
}

export function deactivate(): void {
    // Nothing to clean up: DomainProcessBindingPanel disposes itself via its own onDidDispose handler.
}

async function showDomainProcessBindings(logger: Logger): Promise<void> {
    const workspaceFolder = await pickWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const target = await pickBindingSource(workspaceFolder, logger);
    if (!target) {
        return;
    }

    // SObject and trigger-event selection live inside the panel itself from here — it opens showing
    // its loading state (disabled dropdowns double as the "still working" indicator) and is the
    // single place every outcome (data, error, or zero bindings) renders to.
    DomainProcessBindingPanel.open();

    try {
        const allRows = await getDomainProcessBindings(workspaceFolder.uri.fsPath, target, undefined, logger);
        if (allRows.length === 0) {
            DomainProcessBindingPanel.showEmpty();
            return;
        }
        DomainProcessBindingPanel.setRows(allRows);
    } catch (error) {
        DomainProcessBindingPanel.showError(errorMessage(error));
    }
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        void vscode.window.showErrorMessage('Open a Salesforce DX project folder first.');
        return undefined;
    }
    if (folders.length === 1) {
        return folders[0];
    }

    type FolderItem = vscode.QuickPickItem & { folder: vscode.WorkspaceFolder };
    const items: FolderItem[] = folders.map((folder) => ({ label: folder.name, folder }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a workspace folder' });
    return picked?.folder;
}

type OrgSummary = { username: string; alias?: string };

async function listOrgs(cwd: string, logger: Logger): Promise<OrgSummary[]> {
    const start = Date.now();
    try {
        // `execa` is ESM-only; imported dynamically since this extension is bundled as CommonJS.
        const { execa } = await import('execa');
        const { stdout } = await execa('sf', ['org', 'list', '--json'], {
            cwd,
            // See the matching comment in at4dxCli.ts: no TTY here to answer a stray prompt, so close
            // stdin and cap the wait rather than risk hanging silently.
            stdin: 'ignore',
            timeout: 30_000,
            env: { SF_AUTOUPDATE_DISABLE: 'true', SF_DISABLE_TELEMETRY: 'true' },
        });
        logger.log(`${new Date().toISOString()} org list — ${Date.now() - start}ms — ok`);
        const parsed = JSON.parse(stdout as string) as {
            result?: { nonScratchOrgs?: OrgSummary[]; scratchOrgs?: OrgSummary[] };
        };
        return [...(parsed.result?.nonScratchOrgs ?? []), ...(parsed.result?.scratchOrgs ?? [])];
    } catch (error) {
        logger.log(`${new Date().toISOString()} org list — ${Date.now() - start}ms — failed`);
        logger.log(`org list error: ${(error as Error).message ?? error}`, { verbose: true });
        return [];
    }
}

async function pickBindingSource(workspaceFolder: vscode.WorkspaceFolder, logger: Logger): Promise<BindingSource | undefined> {
    // Local Source is always instant; org lookup shells out to `sf` and can be slow, so it only runs
    // (and only makes the user wait) once they've actually asked for it — the picker itself never
    // blocks on `sf org list`.
    type SourceKindItem = vscode.QuickPickItem & { sourceKind: 'local' | 'localFolder' | 'org' };
    const sourceKindItems: SourceKindItem[] = [
        { label: '$(folder) Local Source', description: workspaceFolder.uri.fsPath, sourceKind: 'local' },
        { label: '$(folder-opened) Choose Source Folder…', sourceKind: 'localFolder' },
        { label: '$(cloud) Connected Org…', sourceKind: 'org' },
    ];

    const pickedKind = await vscode.window.showQuickPick(sourceKindItems, {
        placeHolder: 'Read AT4DX bindings from…',
    });
    if (!pickedKind) {
        return undefined;
    }
    if (pickedKind.sourceKind === 'local') {
        return { kind: 'source', dirs: [workspaceFolder.uri.fsPath] };
    }
    if (pickedKind.sourceKind === 'localFolder') {
        const picked = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            defaultUri: workspaceFolder.uri,
            openLabel: 'Select Source Directory',
        });
        return picked && picked.length > 0 ? { kind: 'source', dirs: [picked[0].fsPath] } : undefined;
    }

    const orgs = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Looking up connected orgs…' },
        () => listOrgs(workspaceFolder.uri.fsPath, logger),
    );
    if (orgs.length === 0) {
        void vscode.window.showInformationMessage('No connected orgs found.');
        return undefined;
    }

    type OrgItem = vscode.QuickPickItem & { username: string };
    const orgItems: OrgItem[] = orgs.map((org) => ({
        label: `$(cloud) ${org.alias ?? org.username}`,
        description: org.alias ? org.username : undefined,
        username: org.username,
    }));
    const pickedOrg = await vscode.window.showQuickPick(orgItems, { placeHolder: 'Select a connected org' });
    return pickedOrg ? { kind: 'org', username: pickedOrg.username } : undefined;
}

function errorMessage(error: unknown): string {
    const message =
        error instanceof At4dxCliError ? error.message : `Unexpected error reading AT4DX bindings: ${(error as Error).message}`;
    const debugHint = vscode.workspace.getConfiguration('simply-at4dx').get<boolean>('debug', false)
        ? 'See the "AT4DX Domain Process Bindings" output channel for the full command and captured output.'
        : 'See the "AT4DX Domain Process Bindings" output channel for details, or enable the simply-at4dx.debug setting and retry for the full command and captured output.';
    return `${message}\n\n${debugHint}`;
}
