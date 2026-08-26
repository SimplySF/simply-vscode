import { AuthInfo, SfProject } from '@salesforce/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { At4dxCliError, getDomainProcessBindings, type BindingSource } from './at4dxCli';
import { DomainProcessBindingPanel } from './domainProcessBindingPanel';
import { createOutputChannelLogger, type Logger } from './logger';

// `@salesforce/core` builds its `Logger` singleton with a worker-thread file transport unless this
// is set, and that transport doesn't survive esbuild bundling this extension into a single file (see
// docs/design/0005-at4dx-org-list-via-core.md) — must be set before any `@salesforce/core` API runs.
process.env.SF_DISABLE_LOG_FILE = 'true';

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
        const { rows, issues, rules } = await getDomainProcessBindings(target, undefined, logger);
        if (rows.length === 0 && issues.length === 0) {
            DomainProcessBindingPanel.showEmpty();
            return;
        }
        DomainProcessBindingPanel.setData(rows, issues, rules, target.kind);
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

async function listOrgs(logger: Logger): Promise<OrgSummary[]> {
    const start = Date.now();
    try {
        // Reads the same local auth files `sf org list` does, in-process — no `sf` on PATH needed.
        // Orgs whose auth file failed to parse (`error` set) aren't usable picks, so they're filtered
        // here; expired orgs are left in, matching `sf org list`'s own behavior.
        const orgs = await AuthInfo.listAllAuthorizations((org) => !org.error);
        logger.log(`${new Date().toISOString()} org list — ${Date.now() - start}ms — ok`);
        return orgs.map((org) => ({ username: org.username, alias: org.aliases?.[0] }));
    } catch (error) {
        logger.log(`${new Date().toISOString()} org list — ${Date.now() - start}ms — failed`);
        logger.log(`org list error: ${(error as Error).message ?? error}`, { verbose: true });
        return [];
    }
}

// Best-guess directory for "Local Source" to scan — see docs/design/0008-at4dx-default-source-folder.md.
// Any resolution failure (no sfdx-project.json, no packageDirectories, resolved path missing on disk)
// is a silent fallthrough to the next rule; this is a UX nicety, not something worth surfacing to the
// user.
async function resolveDefaultSourceDir(workspaceFolder: vscode.WorkspaceFolder): Promise<vscode.Uri> {
    const workspacePath = workspaceFolder.uri.fsPath;
    try {
        const project = await SfProject.resolve(workspacePath);
        const defaultPackage = project.getDefaultPackage();
        if (fs.existsSync(defaultPackage.fullPath)) {
            return vscode.Uri.file(defaultPackage.fullPath);
        }
    } catch {
        // No sfdx-project.json above workspacePath, or it has no packageDirectories — fall through.
    }

    for (const candidate of ['sfdx-source', 'force-app']) {
        const candidatePath = path.join(workspacePath, candidate);
        if (fs.existsSync(candidatePath)) {
            return vscode.Uri.file(candidatePath);
        }
    }

    return workspaceFolder.uri;
}

async function pickBindingSource(workspaceFolder: vscode.WorkspaceFolder, logger: Logger): Promise<BindingSource | undefined> {
    // Local Source is always instant; org lookup reads local Salesforce CLI auth files, so it only
    // runs (and only makes the user wait) once they've actually asked for it — the picker itself
    // never blocks on it.
    const defaultSourceDir = await resolveDefaultSourceDir(workspaceFolder);

    type SourceKindItem = vscode.QuickPickItem & { sourceKind: 'local' | 'localFolder' | 'org' };
    const sourceKindItems: SourceKindItem[] = [
        { label: '$(folder) Local Source', description: defaultSourceDir.fsPath, sourceKind: 'local' },
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
        return { kind: 'source', dirs: [defaultSourceDir.fsPath] };
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
        () => listOrgs(logger),
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
