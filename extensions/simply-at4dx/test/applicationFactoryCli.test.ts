import { AuthInfo } from '@salesforce/core';
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApplicationFactoryBinding, getApplicationFactoryBindings, updateApplicationFactoryBinding } from '../src/applicationFactoryCli';
import type { BindingSource } from '../src/at4dxCli';

// Same dynamic-`import()` mocking approach `at4dxCli.test.ts` already validated — see that file's own
// comment and docs/design/0010's spike.
const { scanLocalBindingsMock, scanOrgBindingsMock, resolveBindingsMock, validateBindingsMock, createBindingMock, updateBindingMock, BindingWriteError } =
    vi.hoisted(() => {
        class BindingWriteError extends Error {
            public constructor(
                public readonly code: string,
                message: string,
                public readonly issues?: unknown[],
            ) {
                super(message);
                this.name = 'BindingWriteError';
            }
        }
        return {
            scanLocalBindingsMock: vi.fn(),
            scanOrgBindingsMock: vi.fn(),
            resolveBindingsMock: vi.fn(),
            validateBindingsMock: vi.fn(),
            createBindingMock: vi.fn(),
            updateBindingMock: vi.fn(),
            BindingWriteError,
        };
    });

const ALL_BINDING_TYPES = ['Service', 'Selector', 'Domain', 'UnitOfWork'];
const BINDING_RULES = { 'duplicate-to': { rule: 'duplicate-to', severity: 'error', scope: 'scan', title: 'Duplicate To', summary: 'x' } };
const ENTITY_DEFINITION_STANDARD_OBJECTS = new Set(['Account', 'Contact']);

vi.mock('@simplysf/simply-aep-core', () => ({
    ALL_BINDING_TYPES,
    BINDING_RULES,
    ENTITY_DEFINITION_STANDARD_OBJECTS,
    scanLocalBindings: scanLocalBindingsMock,
    scanOrgBindings: scanOrgBindingsMock,
    resolveBindings: resolveBindingsMock,
    validateBindings: validateBindingsMock,
    createBinding: createBindingMock,
    updateBinding: updateBindingMock,
    BindingWriteError,
}));

const sourceTarget: BindingSource = { kind: 'source', dirs: ['force-app/main/default'] };

const $$ = new TestContext();
let orgTarget: BindingSource;

beforeEach(async () => {
    vi.clearAllMocks();
    const testOrg = new MockTestOrgData();
    await $$.stubAuths(testOrg);
    orgTarget = { kind: 'org', username: await testOrg.username };
});

describe('getApplicationFactoryBindings — local source', () => {
    it('scans every binding type, validates, resolves, and returns rows/issues/rules', async () => {
        const records = [{ bindingType: 'Service', developerName: 'PricingServiceBinding', key: 'IPricingService' }];
        scanLocalBindingsMock.mockReturnValue({ records, malformed: [], ambiguous: [] });
        validateBindingsMock.mockReturnValue([{ severity: 'warning', rule: 'sequence-collision' }]);
        resolveBindingsMock.mockReturnValue([{ ...records[0], effective: true }]);

        const result = await getApplicationFactoryBindings(sourceTarget);

        expect(scanLocalBindingsMock).toHaveBeenCalledWith(['force-app/main/default'], ALL_BINDING_TYPES);
        expect(validateBindingsMock).toHaveBeenCalledWith({ records, malformed: [], ambiguous: [] });
        expect(resolveBindingsMock).toHaveBeenCalledWith(records);
        expect(result.rows).toEqual([{ ...records[0], effective: true }]);
        expect(result.issues).toEqual([{ severity: 'warning', rule: 'sequence-collision' }]);
        expect(result.rules).toBe(BINDING_RULES);
        expect(result.standardObjects).toEqual(['Account', 'Contact']);
    });

    it('does NOT throw a not-detected error on an empty scan — Application Factory can legitimately be absent from a project', async () => {
        scanLocalBindingsMock.mockReturnValue({ records: [], malformed: [], ambiguous: [] });
        validateBindingsMock.mockReturnValue([]);
        resolveBindingsMock.mockReturnValue([]);

        const result = await getApplicationFactoryBindings(sourceTarget);

        expect(result.rows).toEqual([]);
        expect(result.issues).toEqual([]);
    });

    it('throws At4dxCliError when the scan itself throws', async () => {
        scanLocalBindingsMock.mockImplementation(() => {
            throw new Error('ENOENT: no such directory');
        });

        await expect(getApplicationFactoryBindings(sourceTarget)).rejects.toThrow('Failed to scan the project directory for Application Factory bindings: ENOENT: no such directory');
    });
});

describe('getApplicationFactoryBindings — connected org', () => {
    it('connects, scans every type, validates, resolves, and returns rows/issues/rules', async () => {
        const records = [{ bindingType: 'Selector', developerName: 'AccountsSelectorBinding', key: 'Account' }];
        scanOrgBindingsMock.mockResolvedValue({ records, malformed: [], ambiguous: [], missingTypes: [] });
        validateBindingsMock.mockReturnValue([]);
        resolveBindingsMock.mockReturnValue([{ ...records[0], effective: true }]);

        const result = await getApplicationFactoryBindings(orgTarget);

        expect(scanOrgBindingsMock).toHaveBeenCalledTimes(1);
        expect(scanOrgBindingsMock.mock.calls[0][1]).toBe(ALL_BINDING_TYPES);
        expect(result.rows).toEqual([{ ...records[0], effective: true }]);
    });

    it('throws At4dxCliError when connecting to the org fails', async () => {
        $$.SANDBOX.stub(AuthInfo, 'create').rejects(new Error('NamedOrgNotFoundError: No authorization found'));

        await expect(getApplicationFactoryBindings(orgTarget)).rejects.toThrow('Failed to connect to the org: NamedOrgNotFoundError: No authorization found');
    });

    it('throws At4dxCliError when the org query fails', async () => {
        scanOrgBindingsMock.mockRejectedValue(new Error('INVALID_SESSION_ID'));

        await expect(getApplicationFactoryBindings(orgTarget)).rejects.toThrow('Failed to query Application Factory bindings from the org: INVALID_SESSION_ID');
    });

    it('throws a not-detected error only when every requested binding type is reported missing', async () => {
        scanOrgBindingsMock.mockResolvedValue({ records: [], malformed: [], ambiguous: [], missingTypes: ALL_BINDING_TYPES });

        await expect(getApplicationFactoryBindings(orgTarget)).rejects.toThrow(/Application Factory doesn't appear to be present/);
    });

    it('does not throw when only some binding types are missing — the rest still have real data', async () => {
        scanOrgBindingsMock.mockResolvedValue({ records: [], malformed: [], ambiguous: [], missingTypes: ['UnitOfWork'] });
        validateBindingsMock.mockReturnValue([]);
        resolveBindingsMock.mockReturnValue([]);

        await expect(getApplicationFactoryBindings(orgTarget)).resolves.toEqual({ rows: [], issues: [], rules: BINDING_RULES, standardObjects: ['Account', 'Contact'] });
    });
});

describe('createApplicationFactoryBinding', () => {
    const input = { bindingType: 'Selector' as const, developerName: 'AccountsSelectorBinding', sobject: 'Account', to: 'AccountsSelector', priority: 10 };

    it('resolves sourceDir from a source target and returns an ok outcome', async () => {
        const writeResult = { developerName: 'AccountsSelectorBinding', bindingType: 'Selector', issues: [] };
        createBindingMock.mockResolvedValue(writeResult);

        const outcome = await createApplicationFactoryBinding(input, sourceTarget);

        expect(createBindingMock).toHaveBeenCalledWith(input, { sourceDir: 'force-app/main/default' });
        expect(outcome).toEqual({ kind: 'ok', result: writeResult });
    });

    it('returns a blocked outcome, not a throw, when validation blocks the write', async () => {
        const issues = [{ severity: 'error', rule: 'duplicate-to' }];
        createBindingMock.mockRejectedValue(new BindingWriteError('validation-failed', 'blocked', issues));

        const outcome = await createApplicationFactoryBinding(input, sourceTarget);

        expect(outcome).toEqual({ kind: 'blocked', issues });
    });

    it('throws At4dxCliError with the underlying message for a non-validation write error', async () => {
        createBindingMock.mockRejectedValue(new BindingWriteError('developer-name-already-exists', 'A binding named "X" already exists.'));

        await expect(createApplicationFactoryBinding(input, sourceTarget)).rejects.toThrow('A binding named "X" already exists.');
    });

    it('surfaces type-field-mismatch as an internal-error message, not the raw validation-speak', async () => {
        createBindingMock.mockRejectedValue(new BindingWriteError('type-field-mismatch', 'priority cannot be set when bindingType is Domain or UnitOfWork.'));

        await expect(createApplicationFactoryBinding(input, sourceTarget)).rejects.toThrow(/Internal error: the form sent a field this binding type doesn't support/);
    });
});

describe('updateApplicationFactoryBinding', () => {
    const input = { bindingType: 'Domain' as const, developerName: 'AccountsDomainBinding', to: 'Accounts' };

    it('resolves sourceDirs from a source target and returns an ok outcome', async () => {
        const writeResult = { developerName: 'AccountsDomainBinding', bindingType: 'Domain', issues: [] };
        updateBindingMock.mockResolvedValue(writeResult);

        const outcome = await updateApplicationFactoryBinding(input, sourceTarget);

        expect(updateBindingMock).toHaveBeenCalledWith(input, { sourceDirs: ['force-app/main/default'] });
        expect(outcome).toEqual({ kind: 'ok', result: writeResult });
    });

    it('returns a blocked outcome, not a throw, when validation blocks the write', async () => {
        const issues = [{ severity: 'error', rule: 'duplicate-domain-sobject' }];
        updateBindingMock.mockRejectedValue(new BindingWriteError('validation-failed', 'blocked', issues));

        const outcome = await updateApplicationFactoryBinding(input, sourceTarget);

        expect(outcome).toEqual({ kind: 'blocked', issues });
    });
});
