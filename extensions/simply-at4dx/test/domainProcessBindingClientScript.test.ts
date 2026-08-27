import { JSDOM, type DOMWindow } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractClientScript } from './support/extractClientScript';

// Deliberately not vitest's `environment: 'jsdom'` (a single `window` shared across every `it()` in the
// file): CLIENT_SCRIPT registers a `window.addEventListener('message', ...)` on every run, so reusing
// one global `window` across tests would pile up a stale listener per prior test — each still holding a
// closure over that test's now-gone DOM. Constructing a fresh `JSDOM` per test gives each one its own
// isolated `window`/`document`, the same approach the ad hoc verification behind 0009/0010 already
// proved out.
const clientScript = extractClientScript();

type PostedMessage = { command: string; [key: string]: unknown };

function renderPanel(rows: unknown[], issues: unknown[] = [], ruleInfo: Record<string, unknown> = {}, isLocalScan = true) {
    const html = `<!doctype html>
<html><body>
  <div id="summary"></div>
  <div class="toolbar">
    <label>SObject<select id="sobjectSelect" disabled><option>&mdash;</option></select></label>
    <label>Trigger Event<select id="familySelect" disabled><option>&mdash;</option></select></label>
    <span class="spacer"></span>
    <button id="newBindingBtn">+ New Binding</button>
  </div>
  <div id="content"></div>
</body></html>`;

    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;

    const messages: PostedMessage[] = [];
    window.acquireVsCodeApi = () => ({
        postMessage: (message: PostedMessage) => messages.push(message),
        setState: () => undefined,
        getState: () => undefined,
    });

    const dataScript = [
        `const ALL_ROWS = ${JSON.stringify(rows)};`,
        `const ALL_ISSUES = ${JSON.stringify(issues)};`,
        `const RULE_INFO = ${JSON.stringify(ruleInfo)};`,
        `const IS_LOCAL_SCAN = ${isLocalScan};`,
    ].join('\n');

    dom.window.eval(dataScript + clientScript);

    return { window, document: window.document, messages };
}

/** Dispatches a real click, constructed via the element's own JSDOM window (not vitest's Node globals). */
function click(el: Element): void {
    const view = el.ownerDocument.defaultView as unknown as DOMWindow;
    el.dispatchEvent(new view.Event('click', { bubbles: true }));
}

/** Simulates the host posting a message back to the webview, via the document's own JSDOM window. */
function postFromHost(document: Document, data: unknown): void {
    const view = document.defaultView as unknown as DOMWindow;
    view.dispatchEvent(new view.MessageEvent('message', { data }));
}

const baseRow = {
    developerName: 'Account_Before_Insert_Assign_Owner',
    label: 'Account Assign Owner',
    sobject: 'Account',
    sobjectField: 'primary',
    processContext: 'TriggerExecution',
    triggerOperation: 'Before_Insert',
    type: 'Action',
    classToInject: 'AccountAssignOwnerAction',
    order: 10,
    isActive: true,
    executeAsynchronous: false,
    logicalInverse: false,
    preventRecursive: false,
    source: 'force-app/main/default',
    filePath: 'C:\\ws\\force-app\\main\\default\\customMetadata\\DomainProcessBinding.Account_Before_Insert_Assign_Owner.md-meta.xml',
};

/** Fills in the fields required to submit the create form, leaving Trigger Operation for the caller. */
function fillRequiredCreateFields(document: Document): void {
    (document.getElementById('fDeveloperName') as HTMLInputElement).value = 'Account_After_Insert_Notify';
    (document.getElementById('fClassToInject') as HTMLInputElement).value = 'AccountNotifyAction';
    (document.getElementById('fOrder') as HTMLInputElement).value = '20';
    (document.getElementById('fTriggerOperation') as HTMLSelectElement).value = 'After_Insert';
}

describe('domain process binding client script', () => {
    it('populates the SObject/Trigger Event dropdowns and renders rows on load', () => {
        const { document } = renderPanel([baseRow]);

        expect((document.getElementById('sobjectSelect') as HTMLSelectElement).disabled).toBe(false);
        expect((document.getElementById('sobjectSelect') as HTMLSelectElement).value).toBe('Account');
        expect(document.querySelectorAll('.row')).toHaveLength(1);
    });

    it('renders correctly with multiple SObjects, an org-sourced row (no filePath), issues, and an alternate-field/domain-method row', () => {
        const rows = [
            baseRow,
            { ...baseRow, developerName: 'Contact_After_Update_Sync', sobject: 'Contact', triggerOperation: 'After_Update', type: 'Criteria', filePath: undefined, source: 'my-org' },
            { ...baseRow, developerName: 'ServiceResource_Sync', sobject: 'ServiceResource', sobjectField: 'alternate', isActive: false, filePath: undefined, source: 'my-org' },
            { ...baseRow, developerName: 'Account_Recalc', processContext: 'DomainMethodExecution', triggerOperation: undefined, domainMethodToken: 'RecalcTotals' },
        ];
        const issues = [
            { severity: 'error', rule: 'order-collision', scope: 'record', message: 'boom', developerName: baseRow.developerName, sobject: 'Account', source: baseRow.source },
            { severity: 'warning', rule: 'ambiguous-sobject-reference', scope: 'record', message: 'boom', developerName: 'ServiceResource_Sync', sobject: 'ServiceResource', source: 'my-org' },
        ];

        const { document } = renderPanel(rows, issues, {
            'order-collision': { rule: 'order-collision', severity: 'error', scope: 'record', title: 'Order collision', summary: 'x' },
            'ambiguous-sobject-reference': { rule: 'ambiguous-sobject-reference', severity: 'warning', scope: 'record', title: 'Ambiguous SObject reference', summary: 'x' },
        });

        expect(Array.from(document.querySelectorAll<HTMLOptionElement>('#sobjectSelect option')).map((o: HTMLOptionElement) => o.value)).toEqual([
            'Account',
            'Contact',
            'ServiceResource',
        ]);
    });

    it('"+ New Binding" opens the create form prefilled from the current dropdown selection', () => {
        const { document } = renderPanel([baseRow]);

        click(document.getElementById('newBindingBtn')!);

        expect(document.getElementById('fDeveloperName')).not.toBeNull();
        expect((document.getElementById('fDeveloperName') as HTMLInputElement).disabled).toBe(false);
        expect((document.getElementById('fSobject') as HTMLInputElement).value).toBe('Account');
        expect((document.getElementById('sobjectSelect') as HTMLSelectElement).disabled).toBe(true);
        expect((document.getElementById('newBindingBtn') as HTMLButtonElement).disabled).toBe(true);
    });

    it('blocks submit client-side and reports field errors when required fields are missing', () => {
        const { document, messages } = renderPanel([baseRow]);
        click(document.getElementById('newBindingBtn')!);

        click(document.getElementById('formSave')!);

        expect(messages).toHaveLength(0);
        expect(document.getElementById('fDeveloperNameError')!.textContent).not.toBe('');
    });

    it('requires an explicit Trigger Operation choice — the blank placeholder is not a valid submission', () => {
        const { document, messages } = renderPanel([baseRow]);
        click(document.getElementById('newBindingBtn')!);
        (document.getElementById('fDeveloperName') as HTMLInputElement).value = 'Account_After_Insert_Notify';
        (document.getElementById('fClassToInject') as HTMLInputElement).value = 'AccountNotifyAction';
        (document.getElementById('fOrder') as HTMLInputElement).value = '20';
        // Trigger Operation left at its default blank placeholder.

        click(document.getElementById('formSave')!);

        expect(messages).toHaveLength(0);
        expect(document.getElementById('fTriggerOperationError')!.textContent).not.toBe('');
    });

    it('submits the expected payload once required fields are filled, with domainMethodToken omitted', () => {
        const { document, messages } = renderPanel([baseRow]);
        click(document.getElementById('newBindingBtn')!);
        fillRequiredCreateFields(document);

        click(document.getElementById('formSave')!);

        expect(messages).toHaveLength(1);
        const [message] = messages;
        expect(message.command).toBe('submitBinding');
        expect(message.mode).toBe('create');
        expect(message.force).toBe(false);
        expect(message.input).toMatchObject({
            developerName: 'Account_After_Insert_Notify',
            sobject: 'Account',
            processContext: 'TriggerExecution',
            triggerOperation: 'After_Insert',
            classToInject: 'AccountNotifyAction',
            order: 20,
            isActive: true,
        });
        expect((message.input as Record<string, unknown>).domainMethodToken).toBeUndefined();
    });

    it('a Domain Method Execution submission omits triggerOperation and includes domainMethodToken', () => {
        const { document, messages } = renderPanel([baseRow]);
        click(document.getElementById('newBindingBtn')!);
        (document.getElementById('fDeveloperName') as HTMLInputElement).value = 'Account_Recalc';
        (document.getElementById('fClassToInject') as HTMLInputElement).value = 'AccountRecalcAction';
        (document.getElementById('fOrder') as HTMLInputElement).value = '10';
        (document.getElementById('fProcessContext') as HTMLSelectElement).value = 'DomainMethodExecution';
        const changeView = document.defaultView as unknown as DOMWindow;
        document.getElementById('fProcessContext')!.dispatchEvent(new changeView.Event('change'));
        (document.getElementById('fDomainMethodToken') as HTMLInputElement).value = 'RecalcTotals';

        click(document.getElementById('formSave')!);

        expect(messages).toHaveLength(1);
        const input = messages[0].input as Record<string, unknown>;
        expect(input.processContext).toBe('DomainMethodExecution');
        expect(input.domainMethodToken).toBe('RecalcTotals');
        expect(input.triggerOperation).toBeUndefined();
    });

    it('turns Save into "Save Anyway" and resubmits with force: true after a writeBlocked response', () => {
        const { document, messages } = renderPanel([baseRow]);
        click(document.getElementById('newBindingBtn')!);
        fillRequiredCreateFields(document);
        click(document.getElementById('formSave')!);

        postFromHost(document, {
            command: 'writeBlocked',
            issues: [{ severity: 'error', rule: 'order-collision', message: 'Order 20 collides with another active Action.' }],
        });

        const saveBtn = document.getElementById('formSave') as HTMLButtonElement;
        expect(saveBtn.disabled).toBe(false);
        expect(saveBtn.textContent).toBe('Save Anyway');
        expect(document.getElementById('formIssues')!.style.display).not.toBe('none');
        expect(document.getElementById('formIssues')!.innerHTML).toContain('Order 20 collides');

        click(saveBtn);

        expect(messages).toHaveLength(2);
        expect(messages[1].force).toBe(true);
    });

    it('renders a writeError response with the entered fields intact and newlines converted to <br>', () => {
        const { document, messages } = renderPanel([baseRow]);
        click(document.getElementById('newBindingBtn')!);
        fillRequiredCreateFields(document);
        click(document.getElementById('formSave')!);

        postFromHost(document, { command: 'writeError', message: 'Failed to deploy the binding: boom\n\nSee the output channel.' });

        const errorEl = document.getElementById('formError')!;
        expect(errorEl.style.display).not.toBe('none');
        expect(errorEl.innerHTML).toContain('<br>');
        expect((document.getElementById('formSave') as HTMLButtonElement).disabled).toBe(false);
        expect((document.getElementById('fDeveloperName') as HTMLInputElement).value).toBe('Account_After_Insert_Notify');
        expect(messages).toHaveLength(1); // the writeError response itself never came from this script — no second postMessage happened
    });

    it('Cancel returns to the data view and re-enables the toolbar', () => {
        const { document } = renderPanel([baseRow]);
        click(document.getElementById('newBindingBtn')!);

        click(document.getElementById('formCancel')!);

        expect(document.getElementById('fDeveloperName')).toBeNull();
        expect(document.querySelectorAll('.row')).toHaveLength(1);
        expect((document.getElementById('sobjectSelect') as HTMLSelectElement).disabled).toBe(false);
        expect((document.getElementById('newBindingBtn') as HTMLButtonElement).disabled).toBe(false);
    });

    it('the edit icon opens a prefilled edit form and does not also open the class file (stopPropagation)', () => {
        const { document, messages } = renderPanel([baseRow]);

        click(document.querySelector('.row-edit')!);

        expect(messages.filter((m) => m.command === 'openClass')).toHaveLength(0);
        const developerNameInput = document.getElementById('fDeveloperName') as HTMLInputElement;
        expect(developerNameInput.disabled).toBe(true);
        expect(developerNameInput.value).toBe('Account_Before_Insert_Assign_Owner');
        expect((document.getElementById('fOrder') as HTMLInputElement).value).toBe('10');
        expect((document.getElementById('fTriggerOperation') as HTMLSelectElement).value).toBe('Before_Insert');
        expect((document.getElementById('fSobjectAlternateInput') as HTMLInputElement).checked).toBe(false);
    });

    it('clicking a row body (not the edit icon) posts openClass with the row\'s classToInject', () => {
        const { document, messages } = renderPanel([baseRow]);

        click(document.querySelector('.row')!);

        expect(messages).toEqual([{ command: 'openClass', classToInject: 'AccountAssignOwnerAction' }]);
    });
});
