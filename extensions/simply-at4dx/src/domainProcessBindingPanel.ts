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

const SHARED_STYLE = `
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px;
  }
  .toolbar { display: flex; align-items: flex-end; gap: 16px; margin-bottom: 16px; }
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
  .toolbar .spacer { flex: 1; }
  button {
    font-family: inherit;
    font-size: 0.9em;
    padding: 6px 14px;
    border-radius: 4px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.6; cursor: default; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .row-edit {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    color: var(--vscode-descriptionForeground);
    border-radius: 4px;
  }
  .row-edit:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .row-edit svg { width: 14px; height: 14px; }
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
  .form-title { font-size: 1.1em; font-weight: 600; margin-bottom: 4px; }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 16px;
    margin: 16px 0;
  }
  .form-field { display: flex; flex-direction: column; gap: 4px; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  .form-field.span2 { grid-column: 1 / -1; }
  .form-field input[type="text"],
  .form-field input[type="number"],
  .form-field select,
  .form-field textarea {
    font-family: inherit;
    font-size: 1em;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
    border-radius: 4px;
    padding: 5px 8px;
  }
  .form-field textarea { resize: vertical; min-height: 48px; font-family: inherit; }
  .form-field input:disabled { opacity: 0.6; }
  .form-checkbox { display: flex; flex-direction: row; align-items: center; gap: 6px; font-size: 0.9em; color: var(--vscode-foreground); }
  .form-checkbox input { margin: 0; }
  .form-hint { font-size: 0.8em; color: var(--vscode-descriptionForeground); font-weight: 400; }
  .form-field-error { color: var(--vscode-errorForeground); font-size: 0.85em; min-height: 1.2em; }
  .form-error {
    color: var(--vscode-errorForeground);
    background: var(--vscode-inputValidation-errorBackground, transparent);
    border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
    border-radius: 4px;
    padding: 8px 12px;
    margin-bottom: 12px;
  }
  .form-issues { margin-bottom: 12px; }
  .form-actions { display: flex; gap: 8px; margin-top: 8px; }
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
  const EDIT_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2l3 3-8 8-3.5 1 1-3.5 8-8z"/></svg>';

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
    const rowIndex = ALL_ROWS.indexOf(row);
    return (
      '<div class="row ' + stateClass + '" data-class="' + escapeHtml(row.classToInject) + '" role="button" tabindex="0">' +
      '<span class="row-icon">' + asyncMarker + icon + '</span>' +
      '<span class="row-name">' + escapeHtml(row.developerName) + '</span>' +
      '<span class="row-order">Order: ' + row.order + '</span>' +
      badges +
      '<span class="pill ' + stateClass + '">' + (row.isActive ? 'Active' : 'Inactive') + '</span>' +
      '<span class="row-edit" data-row-index="' + rowIndex + '" title="Edit this binding" role="button" tabindex="0">' + EDIT_ICON + '</span>' +
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

  // --- Create/edit form (docs/design/0009) ---
  // Opening, prefilling, and canceling the form are all client-side (ALL_ROWS already has everything
  // an edit needs to prefill from) — only Save needs the host, since only the host can call
  // createBinding/setBinding. pendingForce is IIFE-scoped rather than local to one renderForm call so
  // the message listener (registered once, below) can flip it after a blocked response and have the
  // next Save click — from whichever renderForm call is currently mounted — see it.
  let pendingForce = false;

  const TRIGGER_OPERATIONS = ['Before_Insert', 'After_Insert', 'Before_Update', 'After_Update', 'Before_Delete', 'After_Delete', 'After_Undelete'];
  const TRIGGER_OPERATION_LABELS = {
    Before_Insert: 'Before Insert', After_Insert: 'After Insert',
    Before_Update: 'Before Update', After_Update: 'After Update',
    Before_Delete: 'Before Delete', After_Delete: 'After Delete',
    After_Undelete: 'After Undelete',
  };

  function fieldError(id, message) {
    const el = document.getElementById(id + 'Error');
    if (el) {
      el.textContent = message || '';
    }
  }

  // Written without a regex literal deliberately — see docs/design/0009's post-implementation note on
  // the "missing /" webview-load failure this avoids.
  function developerNameValid(value) {
    if (!value || value.length > 40) {
      return false;
    }
    const isAsciiLetter = (ch) => (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
    const isAsciiLetterOrDigit = (ch) => isAsciiLetter(ch) || (ch >= '0' && ch <= '9');
    if (!isAsciiLetter(value.charAt(0))) {
      return false;
    }
    for (let i = 0; i < value.length; i++) {
      const ch = value.charAt(i);
      if (!isAsciiLetterOrDigit(ch) && ch !== '_') {
        return false;
      }
    }
    return value.indexOf('__') === -1 && value.charAt(value.length - 1) !== '_';
  }

  function formFieldHtml(id, label, control, opts) {
    opts = opts || {};
    const hint = opts.hint ? ' <span class="form-hint">' + escapeHtml(opts.hint) + '</span>' : '';
    return (
      '<div class="form-field' + (opts.span2 ? ' span2' : '') + '">' +
      '<label for="' + id + '">' + escapeHtml(label) + hint + '</label>' +
      control +
      '<span class="form-field-error" id="' + id + 'Error"></span>' +
      '</div>'
    );
  }

  function renderForm(mode, initial) {
    pendingForce = false;
    sobjectSelect.disabled = true;
    familySelect.disabled = true;
    document.getElementById('newBindingBtn').disabled = true;

    const isEdit = mode === 'edit';
    const developerNameControl = isEdit
      ? '<input type="text" id="fDeveloperName" value="' + escapeHtml(initial.developerName) + '" disabled>'
      : '<input type="text" id="fDeveloperName" value="' + escapeHtml(initial.developerName || '') + '" placeholder="Account_Before_Insert_Assign_Owner">';
    const triggerOpOptions =
      '<option value=""' + (initial.triggerOperation ? '' : ' selected') + '>&mdash; Select &mdash;</option>' +
      TRIGGER_OPERATIONS.map((op) =>
        '<option value="' + op + '"' + (op === initial.triggerOperation ? ' selected' : '') + '>' + TRIGGER_OPERATION_LABELS[op] + '</option>'
      ).join('');
    const flags = [
      ['fIsActive', 'Active', initial.isActive !== false],
      ['fExecuteAsynchronous', 'Execute Asynchronously', !!initial.executeAsynchronous],
      ['fLogicalInverse', 'Logical Inverse', !!initial.logicalInverse],
      ['fPreventRecursive', 'Prevent Recursive', !!initial.preventRecursive],
    ].map((f) => '<label class="form-checkbox"><input type="checkbox" id="' + f[0] + '"' + (f[2] ? ' checked' : '') + '> ' + f[1] + '</label>').join('');

    contentEl.innerHTML =
      '<div class="form-title">' + (isEdit ? 'Edit Binding' : 'New Binding') + '</div>' +
      '<div class="form-error" id="formError" style="display:none"></div>' +
      '<div class="section issues" id="formIssues" style="display:none"></div>' +
      '<div class="form-grid">' +
      formFieldHtml('fDeveloperName', 'Developer Name', developerNameControl) +
      formFieldHtml('fLabel', 'Label', '<input type="text" id="fLabel" value="' + escapeHtml(initial.label || '') + '" placeholder="' + escapeHtml(initial.developerName || '') + '">', { hint: 'Defaults to Developer Name' }) +
      formFieldHtml('fSobject', 'SObject', '<input type="text" id="fSobject" value="' + escapeHtml(initial.sobject || '') + '">') +
      formFieldHtml('fSobjectAlternate', '', '<label class="form-checkbox"><input type="checkbox" id="fSobjectAlternateInput"' + (initial.sobjectField === 'alternate' ? ' checked' : '') + '> Bind via alternate field</label>', { hint: 'For Setup objects like ServiceResource' }) +
      formFieldHtml('fProcessContext', 'Process Context', '<select id="fProcessContext"><option value="TriggerExecution"' + (initial.processContext !== 'DomainMethodExecution' ? ' selected' : '') + '>Trigger Execution</option><option value="DomainMethodExecution"' + (initial.processContext === 'DomainMethodExecution' ? ' selected' : '') + '>Domain Method Execution</option></select>') +
      formFieldHtml('fType', 'Type', '<select id="fType"><option value="Action"' + (initial.type !== 'Criteria' ? ' selected' : '') + '>Action</option><option value="Criteria"' + (initial.type === 'Criteria' ? ' selected' : '') + '>Criteria</option></select>') +
      formFieldHtml('fTriggerOperation', 'Trigger Operation', '<select id="fTriggerOperation">' + triggerOpOptions + '</select>') +
      formFieldHtml('fDomainMethodToken', 'Domain Method Token', '<input type="text" id="fDomainMethodToken" value="' + escapeHtml(initial.domainMethodToken || '') + '">') +
      formFieldHtml('fClassToInject', 'Class to Inject', '<input type="text" id="fClassToInject" value="' + escapeHtml(initial.classToInject || '') + '">') +
      formFieldHtml('fOrder', 'Order', '<input type="number" id="fOrder" step="any" value="' + (initial.order === undefined || initial.order === null ? '' : initial.order) + '">') +
      formFieldHtml('fFlags', '', '<div style="display:flex; gap:16px; flex-wrap:wrap;">' + flags + '</div>', { span2: true }) +
      formFieldHtml('fDescription', 'Description', '<textarea id="fDescription">' + escapeHtml(initial.description || '') + '</textarea>', { span2: true }) +
      '</div>' +
      '<div class="form-actions">' +
      '<button id="formSave">Save</button>' +
      '<button id="formCancel" class="secondary">Cancel</button>' +
      '</div>';
    summaryEl.innerHTML = '';

    const processContextEl = document.getElementById('fProcessContext');
    const triggerOpField = document.getElementById('fTriggerOperation').closest('.form-field');
    const domainTokenField = document.getElementById('fDomainMethodToken').closest('.form-field');
    function syncContextFields() {
      const isTrigger = processContextEl.value !== 'DomainMethodExecution';
      triggerOpField.style.display = isTrigger ? '' : 'none';
      domainTokenField.style.display = isTrigger ? 'none' : '';
    }
    processContextEl.addEventListener('change', syncContextFields);
    syncContextFields();

    function closeForm() {
      sobjectSelect.disabled = false;
      familySelect.disabled = false;
      document.getElementById('newBindingBtn').disabled = false;
      render();
    }
    document.getElementById('formCancel').addEventListener('click', closeForm);

    const saveBtn = document.getElementById('formSave');
    saveBtn.addEventListener('click', () => {
      document.getElementById('formError').style.display = 'none';
      ['fDeveloperName', 'fLabel', 'fSobject', 'fClassToInject', 'fOrder', 'fTriggerOperation', 'fDomainMethodToken'].forEach((id) => fieldError(id, ''));

      const developerName = isEdit ? initial.developerName : document.getElementById('fDeveloperName').value.trim();
      const label = document.getElementById('fLabel').value.trim();
      const sobject = document.getElementById('fSobject').value.trim();
      const classToInject = document.getElementById('fClassToInject').value.trim();
      const orderRaw = document.getElementById('fOrder').value.trim();
      const processContext = processContextEl.value;
      const isTrigger = processContext !== 'DomainMethodExecution';
      const order = Number(orderRaw);
      const triggerOperation = document.getElementById('fTriggerOperation').value;
      const domainMethodToken = document.getElementById('fDomainMethodToken').value.trim();

      let hasError = false;
      if (!isEdit && !developerNameValid(developerName)) {
        fieldError('fDeveloperName', 'Must start with a letter, contain only letters/numbers/single underscores, not end with an underscore, and be 40 characters or fewer.');
        hasError = true;
      }
      if (label.length > 40) {
        fieldError('fLabel', 'Must be 40 characters or fewer.');
        hasError = true;
      }
      if (!sobject) {
        fieldError('fSobject', 'Required.');
        hasError = true;
      }
      if (!classToInject) {
        fieldError('fClassToInject', 'Required.');
        hasError = true;
      }
      if (orderRaw === '' || Number.isNaN(order)) {
        fieldError('fOrder', 'Required, numeric.');
        hasError = true;
      }
      if (isTrigger && !triggerOperation) {
        fieldError('fTriggerOperation', 'Required.');
        hasError = true;
      }
      if (!isTrigger && !domainMethodToken) {
        fieldError('fDomainMethodToken', 'Required.');
        hasError = true;
      }
      if (hasError) {
        return;
      }

      const payload = {
        developerName: developerName,
        label: label,
        sobject: sobject,
        sobjectAlternate: document.getElementById('fSobjectAlternateInput').checked,
        processContext: processContext,
        triggerOperation: isTrigger ? triggerOperation : undefined,
        domainMethodToken: isTrigger ? undefined : domainMethodToken,
        type: document.getElementById('fType').value,
        classToInject: classToInject,
        order: order,
        isActive: document.getElementById('fIsActive').checked,
        executeAsynchronous: document.getElementById('fExecuteAsynchronous').checked,
        logicalInverse: document.getElementById('fLogicalInverse').checked,
        preventRecursive: document.getElementById('fPreventRecursive').checked,
        description: document.getElementById('fDescription').value.trim(),
      };

      saveBtn.disabled = true;
      vscode.postMessage({ command: 'submitBinding', mode: mode, input: payload, force: pendingForce });
    });
  }

  function openCreateForm() {
    const family = familySelect.value;
    renderForm('create', {
      sobject: sobjectSelect.value || '',
      processContext: family === 'DomainMethod' ? 'DomainMethodExecution' : 'TriggerExecution',
      type: 'Action',
      isActive: true,
    });
  }

  function openEditForm(row) {
    renderForm('edit', row);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    const saveBtn = document.getElementById('formSave');
    if (!saveBtn) {
      return;
    }
    if (message.command === 'writeBlocked') {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Anyway';
      pendingForce = true;
      const issuesEl = document.getElementById('formIssues');
      issuesEl.style.display = '';
      issuesEl.innerHTML =
        '<div class="section-header"><span class="section-title">This would introduce a wiring problem</span></div>' +
        message.issues.map((issue) => {
          const sevClass = issue.severity === 'error' ? 'error' : 'warning';
          return (
            '<div class="issue ' + sevClass + '">' +
            '<span class="issue-icon ' + sevClass + '">⚠</span>' +
            '<span class="issue-title">' + escapeHtml(ruleTitle(issue.rule)) + '</span>' +
            (issue.developerName ? '<span class="issue-meta">' + escapeHtml(issue.developerName) + '</span>' : '') +
            '<span class="issue-message">' + escapeHtml(issue.message) + '</span>' +
            '</div>'
          );
        }).join('');
    } else if (message.command === 'writeError') {
      saveBtn.disabled = false;
      const errorEl = document.getElementById('formError');
      errorEl.style.display = '';
      errorEl.innerHTML = escapeHtml(message.message).split('\n').join('<br>');
    }
  });

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

    for (const el of contentEl.querySelectorAll('.row-edit')) {
      const edit = (event) => {
        event.stopPropagation();
        openEditForm(ALL_ROWS[Number(el.dataset.rowIndex)]);
      };
      el.addEventListener('click', edit);
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          edit(event);
        }
      });
    }
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
  document.getElementById('newBindingBtn').addEventListener('click', openCreateForm);

  render();
})();
`;

function buildDropdownsHtml(state: PanelState): string {
    const placeholder = state.kind === 'loading' ? 'Loading…' : '—';
    const canWrite = state.kind === 'data';
    return `
    <div class="toolbar">
      <label>SObject
        <select id="sobjectSelect" disabled><option>${placeholder}</option></select>
      </label>
      <label>Trigger Event
        <select id="familySelect" disabled><option>${placeholder}</option></select>
      </label>
      <span class="spacer"></span>
      <button id="newBindingBtn" ${canWrite ? '' : 'disabled'}>+ New Binding</button>
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
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function buildDataScript(state: PanelState): string {
    if (state.kind !== 'data') {
        return 'const ALL_ROWS = null;\nconst ALL_ISSUES = [];\nconst RULE_INFO = {};\nconst IS_LOCAL_SCAN = false;';
    }
    return [
        `const ALL_ROWS = ${embedJsonInScript(state.rows)};`,
        `const ALL_ISSUES = ${embedJsonInScript(state.issues)};`,
        `const RULE_INFO = ${embedJsonInScript(state.rules)};`,
        `const IS_LOCAL_SCAN = ${state.target.kind === 'source'};`,
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
    private logger: Logger | undefined;

    /**
     * Opens the panel (or reveals/resets an existing one) showing its loading state. `logger` is kept
     * for the lifetime of the panel instance — a create/edit's write call and the rescan that follows a
     * successful one (see `submitBinding` below) both happen entirely from inside the panel, not via a
     * round trip back through `extension.ts`, so the panel needs its own reference rather than being
     * handed one per call the way the initial scan is.
     */
    public static open(logger: Logger): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (DomainProcessBindingPanel.currentPanel) {
            DomainProcessBindingPanel.currentPanel.logger = logger;
            DomainProcessBindingPanel.currentPanel.panel.reveal(column);
            DomainProcessBindingPanel.currentPanel.render({ kind: 'loading' });
            return;
        }

        const panel = vscode.window.createWebviewPanel('simplyAt4dxDomainProcessBindings', 'AT4DX Bindings', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        DomainProcessBindingPanel.currentPanel = new DomainProcessBindingPanel(panel, logger);
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

    private constructor(panel: vscode.WebviewPanel, logger: Logger) {
        this.panel = panel;
        this.logger = logger;
        this.panel.title = 'AT4DX Bindings';
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
