import * as vscode from 'vscode';
import type { DomainProcessBindingRow, TriggerOperation } from './at4dxCli';

/** The trigger-event grouping the user picked, or `DomainMethod` for AT4DX's non-trigger process context. */
export type OperationFamily = 'Created' | 'Updated' | 'Deleted' | 'Undeleted' | 'DomainMethod';

const FAMILY_LABEL: Record<Exclude<OperationFamily, 'DomainMethod'>, string> = {
    Created: 'Created',
    Updated: 'Updated',
    Deleted: 'Deleted',
    Undeleted: 'Undeleted',
};

/** Which `TriggerOperation` values belong to each family. Undelete has no "before" trigger context in Salesforce, so it has no `before` entry. */
const TRIGGER_OPS_BY_FAMILY: Record<Exclude<OperationFamily, 'DomainMethod'>, { before?: TriggerOperation; after?: TriggerOperation }> = {
    Created: { before: 'Before_Insert', after: 'After_Insert' },
    Updated: { before: 'Before_Update', after: 'After_Update' },
    Deleted: { before: 'Before_Delete', after: 'After_Delete' },
    Undeleted: { after: 'After_Undelete' },
};

const CRITERIA_ICON =
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14l-5.5 6.2V13l-3 1.6V8.2L1 2z"/></svg>';
const ACTION_ICON = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9 1 2.5 9.5H7L6 15l6.5-8.5H8L9 1z"/></svg>';
const ASYNC_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l5 5-5 5M8 3l5 5-5 5"/></svg>';
const CROWN_ICON =
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5l3 2 4-4 4 4 3-2-1.5 8h-11L1 5zm2.5 9.5h9v1h-9v-1z"/></svg>';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

function sectionTitle(operation: TriggerOperation): string {
    switch (operation) {
        case 'Before_Insert':
        case 'Before_Update':
            return 'Record Before Save';
        case 'After_Insert':
        case 'After_Update':
            return 'Record After Save';
        case 'Before_Delete':
            return 'Record Before Delete';
        case 'After_Delete':
            return 'Record After Delete';
        case 'After_Undelete':
            return 'Record After Undelete';
    }
}

function headerHtml(sobject: string, family: OperationFamily): string {
    if (family === 'DomainMethod') {
        return `When a(n) <strong>${escapeHtml(sobject)}</strong> domain method <strong>executes</strong>`;
    }
    return `When a(n) <strong>${escapeHtml(sobject)}</strong> record is <strong>${FAMILY_LABEL[family]}</strong>`;
}

function rowHtml(row: DomainProcessBindingRow): string {
    const icon = row.type === 'Criteria' ? CRITERIA_ICON : ACTION_ICON;
    const asyncMarker = row.executeAsynchronous
        ? `<span class="async-icon" title="Executes asynchronously">${ASYNC_ICON}</span>`
        : '';
    const stateClass = row.isActive ? 'active' : 'inactive';
    const collisionBadge = row.orderCollision
        ? '<span class="collision" title="Another active binding in this section shares this order — AT4DX does not guarantee which one runs first">⚠ order collision</span>'
        : '';

    return `
    <div class="row ${stateClass}" data-class="${escapeHtml(row.classToInject)}" role="button" tabindex="0">
      <span class="row-icon">${asyncMarker}${icon}</span>
      <span class="row-name">${escapeHtml(row.developerName)}</span>
      <span class="row-order">Order: ${row.order}</span>
      ${collisionBadge}
      <span class="pill ${stateClass}">${row.isActive ? 'Active' : 'Inactive'}</span>
    </div>`;
}

function sectionHtml(title: string, rows: DomainProcessBindingRow[]): string {
    if (rows.length === 0) {
        return '';
    }
    return `
    <div class="section">
      <div class="section-header">
        <span class="section-title">${escapeHtml(title)}</span>
        <span class="section-count">${rows.length} Item(s) &middot; Sorted By Order of Execution</span>
      </div>
      ${rows.map(rowHtml).join('')}
    </div>`;
}

function buildSections(family: OperationFamily, rows: DomainProcessBindingRow[]): string {
    if (family === 'DomainMethod') {
        const byToken = new Map<string, DomainProcessBindingRow[]>();
        for (const row of rows) {
            const token = row.domainMethodToken ?? '(no token)';
            const group = byToken.get(token) ?? [];
            group.push(row);
            byToken.set(token, group);
        }
        return [...byToken.entries()].map(([token, groupRows]) => sectionHtml(token, groupRows)).join('');
    }

    const ops = TRIGGER_OPS_BY_FAMILY[family];
    let sections = '';
    if (ops.before) {
        sections += sectionHtml(
            sectionTitle(ops.before),
            rows.filter((row) => row.triggerOperation === ops.before),
        );
    }
    if (ops.after) {
        sections += sectionHtml(
            sectionTitle(ops.after),
            rows.filter((row) => row.triggerOperation === ops.after),
        );
    }
    return sections;
}

function buildHtml(sobject: string, family: OperationFamily, rows: DomainProcessBindingRow[], nonce: string): string {
    const sections = buildSections(family, rows) || '<p class="empty">No bindings found for this selection.</p>';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 6px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .header svg { width: 24px; height: 24px; color: var(--vscode-textLink-foreground); flex-shrink: 0; }
  .header-text { font-size: 1.05em; }
  .section {
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  .section-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  }
  .section-title { font-weight: 600; }
  .section-count { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    cursor: pointer;
  }
  .row:last-child { border-bottom: none; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row.inactive { opacity: 0.55; }
  .row-icon { display: flex; align-items: center; gap: 4px; width: 18px; height: 18px; color: var(--vscode-textLink-foreground); flex-shrink: 0; }
  .row-icon svg { width: 16px; height: 16px; }
  .async-icon { width: 14px; height: 14px; color: var(--vscode-descriptionForeground); }
  .row-name { flex: 1; color: var(--vscode-textLink-foreground); }
  .row-order { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .collision { color: var(--vscode-editorWarning-foreground); font-size: 0.85em; }
  .pill {
    font-size: 0.8em;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  .pill.inactive { background: transparent; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .empty { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div class="header">
    <span>${CROWN_ICON}</span>
    <div class="header-text">${headerHtml(sobject, family)}</div>
  </div>
  ${sections}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    for (const row of document.querySelectorAll('.row')) {
      const open = () => vscode.postMessage({ command: 'openClass', classToInject: row.dataset.class });
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    }
  </script>
</body>
</html>`;
}

/** Renders and updates the "AT4DX Domain Process Bindings" webview panel. */
export class DomainProcessBindingPanel {
    private static currentPanel: DomainProcessBindingPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly disposables: vscode.Disposable[] = [];

    public static show(sobject: string, family: OperationFamily, rows: DomainProcessBindingRow[]): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (DomainProcessBindingPanel.currentPanel) {
            DomainProcessBindingPanel.currentPanel.panel.reveal(column);
            DomainProcessBindingPanel.currentPanel.update(sobject, family, rows);
            return;
        }

        const panel = vscode.window.createWebviewPanel('simplyAt4dxDomainProcessBindings', 'AT4DX Bindings', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        DomainProcessBindingPanel.currentPanel = new DomainProcessBindingPanel(panel, sobject, family, rows);
    }

    private constructor(panel: vscode.WebviewPanel, sobject: string, family: OperationFamily, rows: DomainProcessBindingRow[]) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (message: { command: string; classToInject?: string }) => {
                if (message.command === 'openClass' && message.classToInject) {
                    void openApexClass(message.classToInject);
                }
            },
            null,
            this.disposables,
        );
        this.update(sobject, family, rows);
    }

    public update(sobject: string, family: OperationFamily, rows: DomainProcessBindingRow[]): void {
        this.panel.title = `AT4DX: ${sobject}`;
        this.panel.webview.html = buildHtml(sobject, family, rows, getNonce());
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

async function openApexClass(className: string): Promise<void> {
    const files = await vscode.workspace.findFiles(`**/${className}.cls`, '**/node_modules/**', 1);
    if (files.length === 0) {
        void vscode.window.showWarningMessage(`Could not find ${className}.cls in this workspace.`);
        return;
    }
    const document = await vscode.workspace.openTextDocument(files[0]);
    await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}
