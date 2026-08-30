import { AuthInfo } from '@salesforce/core';
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getApplicationFactoryBindings, type BindingSource } from '../src/applicationFactoryCli';

// Same dynamic-`import()` mocking approach `at4dxCli.test.ts` already validated — see that file's own
// comment and docs/design/0010's spike.
const { scanLocalBindingsMock, scanOrgBindingsMock, resolveBindingsMock, validateBindingsMock } = vi.hoisted(() => ({
    scanLocalBindingsMock: vi.fn(),
    scanOrgBindingsMock: vi.fn(),
    resolveBindingsMock: vi.fn(),
    validateBindingsMock: vi.fn(),
}));

const ALL_BINDING_TYPES = ['Service', 'Selector', 'Domain', 'UnitOfWork'];
const BINDING_RULES = { 'duplicate-to': { rule: 'duplicate-to', severity: 'error', scope: 'scan', title: 'Duplicate To', summary: 'x' } };

vi.mock('@simplysf/simply-aep-core', () => ({
    ALL_BINDING_TYPES,
    BINDING_RULES,
    scanLocalBindings: scanLocalBindingsMock,
    scanOrgBindings: scanOrgBindingsMock,
    resolveBindings: resolveBindingsMock,
    validateBindings: validateBindingsMock,
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

        await expect(getApplicationFactoryBindings(orgTarget)).resolves.toEqual({ rows: [], issues: [], rules: BINDING_RULES });
    });
});
