import * as vscode from 'vscode';
import type { BindingSource, DomainProcessBindingIssue, DomainProcessBindingRow, DomainProcessBindingRules } from './at4dxCli';

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

/**
 * State the panel can be in. `data` embeds every fetched row and every issue
 * `validateDomainProcessBindings` found — SObject/operation-family selection, and the issue
 * summary/badges/section that go with it, all happen entirely client-side from there, no round trip
 * back to the extension host, since nothing about "show a different already-fetched slice" needs
 * anything only the host can do.
 */
type PanelState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'empty' }
    | {
          kind: 'data';
          rows: DomainProcessBindingRow[];
          issues: DomainProcessBindingIssue[];
          rules: DomainProcessBindingRules;
          sourceKind: BindingSource['kind'];
      };

const SHARED_STYLE = `
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px;
  }
  .toolbar { display: flex; gap: 16px; margin-bottom: 16px; }
  .toolbar label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  .toolbar select {
    min-width: 220px;
    padding: 4px 6px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border));
    border-radius: 4px;
  }
  .toolbar select:disabled { opacity: 0.6; }
  .status { color: var(--vscode-descriptionForeground); }
  .status.error { color: var(--vscode-errorForeground); }
  .summary {
    padding: 8px 12px;
    border-radius: 4px;
    margin-bottom: 12px;
    font-size: 0.9em;
  }
  .summary.clean { color: var(--vscode-descriptionForeground); }
  .summary.problem {
    color: var(--vscode-editorWarning-foreground);
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    cursor: pointer;
  }
  .summary.problem:hover { text-decoration: underline; }
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
  .badge {
    font-size: 0.8em;
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid transparent;
    white-space: nowrap;
  }
  .badge.error { color: var(--vscode-editorError-foreground); border-color: var(--vscode-editorError-foreground); }
  .badge.warning { color: var(--vscode-editorWarning-foreground); border-color: var(--vscode-editorWarning-foreground); }
  .pill {
    font-size: 0.8em;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  .pill.inactive { background: transparent; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .empty { color: var(--vscode-descriptionForeground); }
  .issues { margin-top: 4px; }
  .issues .section-header { display: block; }
  .issue {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  }
  .issue:last-child { border-bottom: none; }
  .issue.clickable { cursor: pointer; }
  .issue.clickable:hover { background: var(--vscode-list-hoverBackground); }
  .issue-icon.error { color: var(--vscode-editorError-foreground); }
  .issue-icon.warning { color: var(--vscode-editorWarning-foreground); }
  .issue-title { font-weight: 600; }
  .issue-meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .issue-message { flex-basis: 100%; color: var(--vscode-descriptionForeground); font-size: 0.9em; }
`;

// Runs inside the webview (a separate JS context from the extension host), so this is plain,
// dependency-free JS rather than TypeScript — it re-renders `#content` from `ALL_ROWS`/`ALL_ISSUES`
// whenever either dropdown changes, entirely client-side, since every row and issue needed to answer
// "bindings (and problems) for a different SObject/trigger event" is already sitting in memory once
// the initial scan completes.
const CLIENT_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const CRITERIA_ICON = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14l-5.5 6.2V13l-3 1.6V8.2L1 2z"/></svg>';
  const ACTION_ICON = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9 1 2.5 9.5H7L6 15l6.5-8.5H8L9 1z"/></svg>';
  const ASYNC_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l5 5-5 5M8 3l5 5-5 5"/></svg>';
  const CROWN_ICON = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 5l3 2 4-4 4 4 3-2-1.5 8h-11L1 5zm2.5 9.5h9v1h-9v-1z"/></svg>';

  const FAMILY_ITEMS = [
    { value: 'Created', label: 'Created' },
    { value: 'Updated', label: 'Updated' },
    { value: 'Deleted', label: 'Deleted' },
    { value: 'Undeleted', label: 'Undeleted' },
    { value: 'DomainMethod', label: 'Domain Method Execution' },
  ];
  const FAMILY_LABEL = { Created: 'Created', Updated: 'Updated', Deleted: 'Deleted', Undeleted: 'Undeleted' };
  const TRIGGER_OPS_BY_FAMILY = {
    Created: { before: 'Before_Insert', after: 'After_Insert' },
    Updated: { before: 'Before_Update', after: 'After_Update' },
    Deleted: { before: 'Before_Delete', after: 'After_Delete' },
    Undeleted: { after: 'After_Undelete' },
  };

  function sectionTitle(operation) {
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
      default:
        return operation;
    }
  }

  function headerHtml(sobject, family) {
    if (family === 'DomainMethod') {
      return 'When a(n) <strong>' + escapeHtml(sobject) + '</strong> domain method <strong>executes</strong>';
    }
    return 'When a(n) <strong>' + escapeHtml(sobject) + '</strong> record is <strong>' + FAMILY_LABEL[family] + '</strong>';
  }

  if (!ALL_ROWS) {
    return;
  }

  // Badges join on record identity and ignore \`scope\`: if an issue names this record, this record
  // has that problem, regardless of how the issue was computed. Built once — it doesn't change as the
  // dropdowns change.
  function recordKey(developerName, source) {
    return developerName + '\\u0000' + source;
  }
  const ISSUES_BY_RECORD = new Map();
  ALL_ISSUES.forEach(function (issue, index) {
    if (!issue.developerName) {
      return;
    }
    const key = recordKey(issue.developerName, issue.source);
    const list = ISSUES_BY_RECORD.get(key) || [];
    list.push({ issue: issue, index: index });
    ISSUES_BY_RECORD.set(key, list);
  });

  function ruleTitle(rule) {
    const info = RULE_INFO[rule];
    return info ? info.title : rule;
  }

  function badgeHtml(entry) {
    const issue = entry.issue;
    const sevClass = issue.severity === 'error' ? 'error' : 'warning';
    return (
      '<span class="badge ' + sevClass + '" title="' + escapeHtml(issue.message) + '">⚠ ' +
      escapeHtml(ruleTitle(issue.rule)) + '</span>'
    );
  }

  function rowHtml(row) {
    const icon = row.type === 'Criteria' ? CRITERIA_ICON : ACTION_ICON;
    const asyncMarker = row.executeAsynchronous
      ? '<span class="async-icon" title="Executes asynchronously">' + ASYNC_ICON + '</span>'
      : '';
    const stateClass = row.isActive ? 'active' : 'inactive';
    const badges = (ISSUES_BY_RECORD.get(recordKey(row.developerName, row.source)) || []).map(badgeHtml).join('');
    return (
      '<div class="row ' + stateClass + '" data-class="' + escapeHtml(row.classToInject) + '" role="button" tabindex="0">' +
      '<span class="row-icon">' + asyncMarker + icon + '</span>' +
      '<span class="row-name">' + escapeHtml(row.developerName) + '</span>' +
      '<span class="row-order">Order: ' + row.order + '</span>' +
      badges +
      '<span class="pill ' + stateClass + '">' + (row.isActive ? 'Active' : 'Inactive') + '</span>' +
      '</div>'
    );
  }

  function sectionHtml(title, rows) {
    if (rows.length === 0) {
      return '';
    }
    return (
      '<div class="section"><div class="section-header">' +
      '<span class="section-title">' + escapeHtml(title) + '</span>' +
      '<span class="section-count">' + rows.length + ' Item(s) &middot; Sorted By Order of Execution</span>' +
      '</div>' + rows.map(rowHtml).join('') + '</div>'
    );
  }

  function buildSections(family, rows) {
    if (family === 'DomainMethod') {
      const byToken = new Map();
      for (const row of rows) {
        const token = row.domainMethodToken || '(no token)';
        const group = byToken.get(token) || [];
        group.push(row);
        byToken.set(token, group);
      }
      return [...byToken.entries()].map(([token, groupRows]) => sectionHtml(token, groupRows)).join('');
    }
    const ops = TRIGGER_OPS_BY_FAMILY[family];
    let sections = '';
    if (ops.before) {
      sections += sectionHtml(sectionTitle(ops.before), rows.filter((row) => row.triggerOperation === ops.before));
    }
    if (ops.after) {
      sections += sectionHtml(sectionTitle(ops.after), rows.filter((row) => row.triggerOperation === ops.after));
    }
    return sections;
  }

  function availableFamilies(sobjectRows) {
    const available = new Set();
    for (const row of sobjectRows) {
      if (row.processContext === 'DomainMethodExecution') {
        available.add('DomainMethod');
        continue;
      }
      switch (row.triggerOperation) {
        case 'Before_Insert':
        case 'After_Insert':
          available.add('Created');
          break;
        case 'Before_Update':
        case 'After_Update':
          available.add('Updated');
          break;
        case 'Before_Delete':
        case 'After_Delete':
          available.add('Deleted');
          break;
        case 'After_Undelete':
          available.add('Undeleted');
          break;
      }
    }
    return available;
  }

  function issueEntryHtml(entry) {
    const issue = entry.issue;
    const sevClass = issue.severity === 'error' ? 'error' : 'warning';
    const clickable = IS_LOCAL_SCAN;
    const attrs = clickable ? ' data-issue-index="' + entry.index + '" role="button" tabindex="0"' : '';
    const meta = [escapeHtml(issue.source)];
    if (issue.sobject) {
      meta.push(escapeHtml(issue.sobject));
    }
    return (
      '<div class="issue ' + sevClass + (clickable ? ' clickable' : '') + '"' + attrs + '>' +
      '<span class="issue-icon ' + sevClass + '">⚠</span>' +
      '<span class="issue-title">' + escapeHtml(ruleTitle(issue.rule)) + '</span>' +
      (issue.developerName ? '<span class="issue-meta">' + escapeHtml(issue.developerName) + '</span>' : '') +
      '<span class="issue-meta">' + meta.join(' &middot; ') + '</span>' +
      '<span class="issue-message">' + escapeHtml(issue.message) + '</span>' +
      '</div>'
    );
  }

  function issuesGroupHtml(title, entries) {
    if (entries.length === 0) {
      return '';
    }
    return (
      '<div><div class="section-header">' +
      '<span class="section-title">' + escapeHtml(title) + '</span>' +
      '<span class="section-count">' + entries.length + ' issue(s)</span>' +
      '</div>' + entries.map(issueEntryHtml).join('') + '</div>'
    );
  }

  function issuesSectionHtml(inView, elsewhere, sobject) {
    if (inView.length === 0 && elsewhere.length === 0) {
      return '';
    }
    return (
      '<div class="section issues" id="issuesSection">' +
      issuesGroupHtml('In ' + sobject, inView) +
      issuesGroupHtml('Elsewhere in this scan', elsewhere) +
      '</div>'
    );
  }

  function summaryHtml(inView, elsewhere) {
    const total = inView.length + elsewhere.length;
    if (total === 0) {
      return '<div class="summary clean">✓ No problems found</div>';
    }
    const all = inView.concat(elsewhere).map((entry) => entry.issue);
    const errors = all.filter((issue) => issue.severity === 'error').length;
    const warnings = all.filter((issue) => issue.severity === 'warning').length;
    const parts = [];
    if (inView.length) {
      parts.push(inView.length + ' in this SObject');
    }
    if (elsewhere.length) {
      parts.push(elsewhere.length + ' elsewhere in this scan');
    }
    return (
      '<div class="summary problem" id="summaryBar" role="button" tabindex="0">⚠ ' +
      errors + ' error(s) &middot; ' + warnings + ' warning(s) (' + parts.join(', ') + ')</div>'
    );
  }

  const contentEl = document.getElementById('content');
  const summaryEl = document.getElementById('summary');
  const sobjectSelect = document.getElementById('sobjectSelect');
  const familySelect = document.getElementById('familySelect');

  function attachInteractiveListeners(selector, buildMessage) {
    for (const el of contentEl.querySelectorAll(selector)) {
      const open = () => vscode.postMessage(buildMessage(el));
      el.addEventListener('click', open);
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    }
  }

  function attachSummaryListener() {
    const bar = document.getElementById('summaryBar');
    if (!bar) {
      return;
    }
    const scroll = () => document.getElementById('issuesSection')?.scrollIntoView({ behavior: 'smooth' });
    bar.addEventListener('click', scroll);
    bar.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        scroll();
      }
    });
  }

  function render() {
    const sobject = sobjectSelect.value;
    const family = familySelect.value;
    const rows = ALL_ROWS.filter((row) => row.sobject === sobject);
    const sections = buildSections(family, rows) || '<p class="empty">No bindings found for this selection.</p>';

    const indexed = ALL_ISSUES.map((issue, index) => ({ issue, index }));
    const inView = indexed.filter((entry) => entry.issue.scope === 'record' && entry.issue.sobject === sobject);
    const elsewhere = indexed.filter((entry) => !(entry.issue.scope === 'record' && entry.issue.sobject === sobject));

    summaryEl.innerHTML = summaryHtml(inView, elsewhere);
    contentEl.innerHTML =
      '<div class="header"><span>' + CROWN_ICON + '</span><div class="header-text">' + headerHtml(sobject, family) + '</div></div>' +
      sections +
      issuesSectionHtml(inView, elsewhere, sobject);

    attachInteractiveListeners('.row', (el) => ({ command: 'openClass', classToInject: el.dataset.class }));
    attachInteractiveListeners('.issue[data-issue-index]', (el) => ({ command: 'openIssue', index: Number(el.dataset.issueIndex) }));
    attachSummaryListener();
  }

  function populateFamilyOptions(sobject) {
    const rows = ALL_ROWS.filter((row) => row.sobject === sobject);
    const available = availableFamilies(rows);
    const items = FAMILY_ITEMS.filter((item) => available.has(item.value));
    familySelect.innerHTML = items.map((item) => '<option value="' + item.value + '">' + item.label + '</option>').join('');
  }

  const sobjects = [...new Set(ALL_ROWS.map((row) => row.sobject))].sort((a, b) => a.localeCompare(b));
  sobjectSelect.innerHTML = sobjects
    .map((sobject) => '<option value="' + escapeHtml(sobject) + '">' + escapeHtml(sobject) + '</option>')
    .join('');
  sobjectSelect.disabled = false;
  familySelect.disabled = false;
  populateFamilyOptions(sobjectSelect.value);

  sobjectSelect.addEventListener('change', () => {
    populateFamilyOptions(sobjectSelect.value);
    render();
  });
  familySelect.addEventListener('change', render);

  render();
})();
`;

function buildDropdownsHtml(state: PanelState): string {
    const placeholder = state.kind === 'loading' ? 'Loading…' : '—';
    return `
    <div class="toolbar">
      <label>SObject
        <select id="sobjectSelect" disabled><option>${placeholder}</option></select>
      </label>
      <label>Trigger Event
        <select id="familySelect" disabled><option>${placeholder}</option></select>
      </label>
    </div>`;
}

function buildInitialContentHtml(state: PanelState): string {
    switch (state.kind) {
        case 'loading':
            return '<p class="status">Scanning workspace for AT4DX bindings…</p>';
        case 'error':
            return `<p class="status error">${escapeHtml(state.message).replace(/\n/g, '<br>')}</p>`;
        case 'empty':
            return '<p class="status">No AT4DX Trigger Action Framework bindings found.</p>';
        case 'data':
            // Populated by CLIENT_SCRIPT immediately on load — no server-rendered default needed.
            return '';
    }
}

/**
 * `</script>`-safe embed of the fetched rows/issues/rules: this text is JS source (not parsed as
 * JSON), so escaping `<` as a unicode escape stays valid JS while stopping the HTML parser from ever
 * seeing something that looks like a closing `</script>` tag inside embedded data (e.g. a
 * `Description__c` or an issue `message`).
 */
function buildDataScript(state: PanelState): string {
    if (state.kind !== 'data') {
        return 'const ALL_ROWS = null;\nconst ALL_ISSUES = [];\nconst RULE_INFO = {};\nconst IS_LOCAL_SCAN = false;';
    }
    const jsSafe = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
    return [
        `const ALL_ROWS = ${jsSafe(state.rows)};`,
        `const ALL_ISSUES = ${jsSafe(state.issues)};`,
        `const RULE_INFO = ${jsSafe(state.rules)};`,
        `const IS_LOCAL_SCAN = ${state.sourceKind === 'source'};`,
    ].join('\n');
}

function buildShellHtml(state: PanelState, nonce: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>${SHARED_STYLE}</style>
</head>
<body>
  <div id="summary"></div>
  ${buildDropdownsHtml(state)}
  <div id="content">${buildInitialContentHtml(state)}</div>
  <script nonce="${nonce}">
    ${buildDataScript(state)}
    ${CLIENT_SCRIPT}
  </script>
</body>
</html>`;
}

/** Opens/updates the "AT4DX Domain Process Bindings" webview panel. */
export class DomainProcessBindingPanel {
    private static currentPanel: DomainProcessBindingPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly disposables: vscode.Disposable[] = [];
    private state: PanelState = { kind: 'loading' };

    /** Opens the panel (or reveals/resets an existing one) showing its loading state. */
    public static open(): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (DomainProcessBindingPanel.currentPanel) {
            DomainProcessBindingPanel.currentPanel.panel.reveal(column);
            DomainProcessBindingPanel.currentPanel.render({ kind: 'loading' });
            return;
        }

        const panel = vscode.window.createWebviewPanel('simplyAt4dxDomainProcessBindings', 'AT4DX Bindings', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        DomainProcessBindingPanel.currentPanel = new DomainProcessBindingPanel(panel);
    }

    public static setData(
        rows: DomainProcessBindingRow[],
        issues: DomainProcessBindingIssue[],
        rules: DomainProcessBindingRules,
        sourceKind: BindingSource['kind'],
    ): void {
        DomainProcessBindingPanel.currentPanel?.render({ kind: 'data', rows, issues, rules, sourceKind });
    }

    public static showError(message: string): void {
        DomainProcessBindingPanel.currentPanel?.render({ kind: 'error', message });
    }

    public static showEmpty(): void {
        DomainProcessBindingPanel.currentPanel?.render({ kind: 'empty' });
    }

    private constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;
        this.panel.title = 'AT4DX Bindings';
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (message: { command: string; classToInject?: string; index?: number }) => {
                if (message.command === 'openClass' && message.classToInject) {
                    void openApexClass(message.classToInject);
                } else if (message.command === 'openIssue' && typeof message.index === 'number') {
                    void this.openIssue(message.index);
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

    private render(state: PanelState): void {
        this.state = state;
        this.panel.webview.html = buildShellHtml(state, getNonce());
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
