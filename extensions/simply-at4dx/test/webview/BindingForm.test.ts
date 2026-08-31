// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BindingForm from '../../src/webview/BindingForm.svelte';
import type { DomainProcessBindingRules } from '../../src/webview/types';

const postMessage = vi.hoisted(() => vi.fn());
vi.mock('../../src/webview/vscodeApi', () => ({ postMessage }));

const rules = {
    'order-collision': { title: 'Order collision', summary: '' },
} as unknown as DomainProcessBindingRules;

function field(id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`#${id} not found`);
    }
    return el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
}

afterEach(() => {
    cleanup();
    postMessage.mockClear();
});

describe('BindingForm — create mode', () => {
    beforeEach(() => {
        render(BindingForm, {
            props: {
                mode: 'create',
                initial: { sobject: 'Account', processContext: 'TriggerExecution', type: 'Action', isActive: true },
                rules,
                scopeSobject: 'Account',
                scopeLabel: 'Created',
                onCancel: vi.fn(),
            },
        });
    });

    it('blocks submission with inline errors when required fields are empty', async () => {
        await fireEvent.click(screen.getByText('Create binding'));

        expect(postMessage).not.toHaveBeenCalled();
        expect(document.getElementById('fDeveloperNameError')?.textContent).toContain('Must start with a letter');
        expect(document.getElementById('fClassToInjectError')?.textContent).toBe('Required.');
        expect(document.getElementById('fOrderError')?.textContent).toBe('Required, numeric.');
        expect(document.getElementById('fTriggerOperationError')?.textContent).toBe('Required.');
    });

    it('posts the exact submitBinding payload for a valid Trigger Execution binding', async () => {
        await fireEvent.input(field('fDeveloperName'), { target: { value: 'Account_Before_Insert_Test' } });
        await fireEvent.input(field('fSobject'), { target: { value: 'Account' } });
        await fireEvent.input(field('fClassToInject'), { target: { value: 'MyActionClass' } });
        await fireEvent.input(field('fOrder'), { target: { value: '10' } });
        await fireEvent.change(field('fTriggerOperation'), { target: { value: 'Before_Insert' } });

        await fireEvent.click(screen.getByText('Create binding'));

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({
            command: 'submitBinding',
            mode: 'create',
            input: {
                developerName: 'Account_Before_Insert_Test',
                label: '',
                sobject: 'Account',
                sobjectAlternate: false,
                processContext: 'TriggerExecution',
                triggerOperation: 'Before_Insert',
                domainMethodToken: undefined,
                type: 'Action',
                classToInject: 'MyActionClass',
                order: 10,
                isActive: true,
                executeAsynchronous: false,
                logicalInverse: false,
                preventRecursive: false,
                description: '',
            },
            force: false,
        });
    });

    it('requires Domain Method Token instead of Trigger Operation once Process Context switches', async () => {
        await fireEvent.change(field('fProcessContext'), { target: { value: 'DomainMethodExecution' } });

        expect(document.getElementById('fTriggerOperation')).toBeNull();
        expect(document.getElementById('fDomainMethodToken')).not.toBeNull();

        await fireEvent.input(field('fDeveloperName'), { target: { value: 'Account_On_Validate' } });
        await fireEvent.input(field('fSobject'), { target: { value: 'Account' } });
        await fireEvent.input(field('fClassToInject'), { target: { value: 'MyCriteria' } });
        await fireEvent.input(field('fOrder'), { target: { value: '1' } });
        await fireEvent.click(screen.getByText('Create binding'));

        expect(postMessage).not.toHaveBeenCalled();
        expect(document.getElementById('fDomainMethodTokenError')?.textContent).toBe('Required.');
    });

    it('flips Save to "Save Anyway" and resubmits with force: true on writeBlocked', async () => {
        await fireEvent.input(field('fDeveloperName'), { target: { value: 'Account_Before_Insert_Test' } });
        await fireEvent.input(field('fSobject'), { target: { value: 'Account' } });
        await fireEvent.input(field('fClassToInject'), { target: { value: 'MyActionClass' } });
        await fireEvent.input(field('fOrder'), { target: { value: '10' } });
        await fireEvent.change(field('fTriggerOperation'), { target: { value: 'Before_Insert' } });
        await fireEvent.click(screen.getByText('Create binding'));

        window.dispatchEvent(
            new MessageEvent('message', {
                data: { command: 'writeBlocked', issues: [{ rule: 'order-collision', severity: 'error', message: 'Collides.' }] },
            }),
        );
        await Promise.resolve();

        expect(screen.getByText('Save Anyway')).toBeTruthy();
        expect(screen.getByText('This would introduce a wiring problem')).toBeTruthy();
        expect(screen.getByText('Order collision')).toBeTruthy();

        postMessage.mockClear();
        await fireEvent.click(screen.getByText('Save Anyway'));

        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    });

    it('renders a writeError message with newlines as line breaks', async () => {
        window.dispatchEvent(new MessageEvent('message', { data: { command: 'writeError', message: 'Line one\nLine two' } }));
        await Promise.resolve();

        const error = document.querySelector('.form-error');
        expect(error?.textContent).toBe('Line oneLine two');
        expect(error?.querySelectorAll('br').length).toBe(1);
    });

    it('calls onCancel when Cancel is clicked', async () => {
        cleanup();
        const onCancel = vi.fn();
        render(BindingForm, { props: { mode: 'create', initial: {}, rules, scopeSobject: 'Account', scopeLabel: 'Created', onCancel } });

        await fireEvent.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when the breadcrumb is clicked', async () => {
        cleanup();
        const onCancel = vi.fn();
        render(BindingForm, { props: { mode: 'create', initial: {}, rules, scopeSobject: 'Account', scopeLabel: 'Created', onCancel } });

        await fireEvent.click(screen.getByText('Account / Created'));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('renders the Type field as a two-option segmented control and lets Criteria be selected', async () => {
        const segmented = document.getElementById('fType') as HTMLElement;
        const options = segmented.querySelectorAll<HTMLButtonElement>('.segmented-option');
        expect(Array.from(options).map((option) => option.textContent)).toEqual(['Action', 'Criteria']);
        expect(options[0]?.classList.contains('selected')).toBe(true);

        await fireEvent.click(options[1]!);
        expect(options[1]?.classList.contains('selected')).toBe(true);
        expect(options[0]?.classList.contains('selected')).toBe(false);

        await fireEvent.input(field('fDeveloperName'), { target: { value: 'Account_Before_Insert_Test' } });
        await fireEvent.input(field('fClassToInject'), { target: { value: 'MyCriteria' } });
        await fireEvent.input(field('fOrder'), { target: { value: '10' } });
        await fireEvent.change(field('fTriggerOperation'), { target: { value: 'Before_Insert' } });
        await fireEvent.click(screen.getByText('Create binding'));

        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ type: 'Criteria' }) }));
    });

    it('hides Execute asynchronously for a Criteria row and never sends a stale true for it', async () => {
        await fireEvent.click(screen.getByText('Execute asynchronously').closest('label')!.querySelector('input')!);
        const segmented = document.getElementById('fType') as HTMLElement;
        await fireEvent.click(segmented.querySelectorAll<HTMLButtonElement>('.segmented-option')[1]!);

        expect(screen.queryByText('Execute asynchronously')).toBeNull();
        expect(screen.getByText('No Execute asynchronously on a Criteria row — the flag only means something for an Action.')).toBeTruthy();

        await fireEvent.input(field('fDeveloperName'), { target: { value: 'Account_Before_Insert_Test' } });
        await fireEvent.input(field('fClassToInject'), { target: { value: 'MyCriteria' } });
        await fireEvent.input(field('fOrder'), { target: { value: '10' } });
        await fireEvent.change(field('fTriggerOperation'), { target: { value: 'Before_Insert' } });
        await fireEvent.click(screen.getByText('Create binding'));

        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ executeAsynchronous: false }) }));
    });

    it('keeps the alternate-SObject toggle a real checkbox bound to sobjectAlternate', async () => {
        const toggle = document.getElementById('fSobjectAlternateInput') as HTMLInputElement;
        expect(toggle.type).toBe('checkbox');
        expect(toggle.checked).toBe(false);

        await fireEvent.click(toggle);
        expect(toggle.checked).toBe(true);

        await fireEvent.input(field('fDeveloperName'), { target: { value: 'Account_Before_Insert_Test' } });
        await fireEvent.input(field('fClassToInject'), { target: { value: 'MyActionClass' } });
        await fireEvent.input(field('fOrder'), { target: { value: '10' } });
        await fireEvent.change(field('fTriggerOperation'), { target: { value: 'Before_Insert' } });
        await fireEvent.click(screen.getByText('Create binding'));

        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ sobjectAlternate: true }) }));
    });

    it('updates the live "resulting binding" preview sentence as the form changes', async () => {
        expect(document.querySelector('.form-preview-text')?.textContent).toContain('…');

        await fireEvent.input(field('fClassToInject'), { target: { value: 'AssignOwner.cls' } });
        await fireEvent.input(field('fOrder'), { target: { value: '10.3' } });
        await fireEvent.change(field('fTriggerOperation'), { target: { value: 'Before_Insert' } });

        const preview = document.querySelector('.form-preview-text')?.textContent ?? '';
        expect(preview).toContain('AssignOwner.cls');
        expect(preview).toContain('10.3');
        expect(preview).toContain('Created');
        expect(preview).toContain('Trigger Execution');
    });
});

describe('BindingForm — edit mode', () => {
    it('disables Developer Name and submits every field, including the unchanged ones', async () => {
        render(BindingForm, {
            props: {
                mode: 'edit',
                initial: {
                    developerName: 'Account_After_Update_Notify',
                    label: 'Notify',
                    sobject: 'Account',
                    processContext: 'TriggerExecution',
                    triggerOperation: 'After_Update',
                    type: 'Criteria',
                    classToInject: 'NotifyCriteria',
                    order: 5,
                    isActive: false,
                    executeAsynchronous: true,
                    logicalInverse: false,
                    preventRecursive: true,
                    description: 'Existing description',
                },
                rules,
                scopeSobject: 'Account',
                scopeLabel: 'Updated',
                onCancel: vi.fn(),
            },
        });

        const developerNameInput = field('fDeveloperName') as HTMLInputElement;
        expect(developerNameInput.disabled).toBe(true);
        expect(developerNameInput.value).toBe('Account_After_Update_Notify');

        expect(screen.getByText('Edit domain process binding')).toBeTruthy();
        const breadcrumb = document.querySelector('.form-breadcrumb-bar');
        expect(breadcrumb?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Account / Updated › CRITERIA');
        expect(document.querySelector('.form-breadcrumb-bar .type-pill')?.classList.contains('type-pill-dashed')).toBe(false);

        await fireEvent.click(screen.getByText('Save changes'));

        expect(postMessage).toHaveBeenCalledWith({
            command: 'submitBinding',
            mode: 'edit',
            input: {
                developerName: 'Account_After_Update_Notify',
                label: 'Notify',
                sobject: 'Account',
                sobjectAlternate: false,
                processContext: 'TriggerExecution',
                triggerOperation: 'After_Update',
                domainMethodToken: undefined,
                type: 'Criteria',
                classToInject: 'NotifyCriteria',
                order: 5,
                isActive: false,
                // Normalized to false on save — this fixture's own `true` is a pre-existing Criteria
                // record the field never should've been set on; the checkbox is hidden for Criteria (see
                // docs/design/0017), so nothing lets the user reintroduce it once cleared here.
                executeAsynchronous: false,
                logicalInverse: false,
                preventRecursive: true,
                description: 'Existing description',
            },
            force: false,
        });
    });
});
