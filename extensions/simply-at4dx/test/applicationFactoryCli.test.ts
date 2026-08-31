import { AuthInfo } from '@salesforce/core';
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createApplicationFactoryBinding,
    createSelectorFieldSetInclusion,
    getApplicationFactoryBindings,
    getFieldSetInclusions,
    updateApplicationFactoryBinding,
    updateSelectorFieldSetInclusion,
} from '../src/applicationFactoryCli';
import type { BindingSource } from '../src/at4dxCli';

// Same dynamic-`import()` mocking approach `at4dxCli.test.ts` already validated — see that file's own
// comment and docs/design/0010's spike.
const {
    scanLocalBindingsMock,
    scanOrgBindingsMock,
    resolveBindingsMock,
    validateBindingsMock,
    createBindingMock,
    updateBindingMock,
    BindingWriteError,
    scanLocalFieldSetInclusionsMock,
    scanOrgFieldSetInclusionsMock,
    validateFieldSetInclusionsMock,
    createFieldSetInclusionMock,
    updateFieldSetInclusionMock,
    FieldSetInclusionWriteError,
} = vi.hoisted(() => {
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
    class FieldSetInclusionWriteError extends Error {
        public constructor(
            public readonly code: string,
            message: string,
            public readonly issues?: unknown[],
        ) {
            super(message);
            this.name = 'FieldSetInclusionWriteError';
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
        scanLocalFieldSetInclusionsMock: vi.fn(),
        scanOrgFieldSetInclusionsMock: vi.fn(),
        validateFieldSetInclusionsMock: vi.fn(),
        createFieldSetInclusionMock: vi.fn(),
        updateFieldSetInclusionMock: vi.fn(),
        FieldSetInclusionWriteError,
    };
});

const ALL_BINDING_TYPES = ['Service', 'Selector', 'Domain', 'UnitOfWork'];
const BINDING_RULES = { 'duplicate-to': { rule: 'duplicate-to', severity: 'error', scope: 'scan', title: 'Duplicate To', summary: 'x' } };
const ENTITY_DEFINITION_STANDARD_OBJECTS = new Set(['Account', 'Contact']);
const FIELD_SET_INCLUSION_RULES = { 'duplicate-fieldset-name': { rule: 'duplicate-fieldset-name', severity: 'error', scope: 'scan', title: 'Duplicate fieldset name', summary: 'x' } };

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
    FIELD_SET_INCLUSION_RULES,
    scanLocalFieldSetInclusions: scanLocalFieldSetInclusionsMock,
    scanOrgFieldSetInclusions: scanOrgFieldSetInclusionsMock,
    validateFieldSetInclusions: validateFieldSetInclusionsMock,
    createFieldSetInclusion: createFieldSetInclusionMock,
    updateFieldSetInclusion: updateFieldSetInclusionMock,
    FieldSetInclusionWriteError,
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

describe('getFieldSetInclusions — local source', () => {
    it('scans, validates, and returns records/issues/rules', async () => {
        const records = [{ developerName: 'Account_TierFields', sobject: 'Account', fieldsetName: 'AccountTierFields', isActive: true }];
        scanLocalFieldSetInclusionsMock.mockReturnValue({ records, malformed: [], ambiguous: [] });
        validateFieldSetInclusionsMock.mockReturnValue([{ severity: 'warning', rule: 'unnecessary-entity-definition-alternate' }]);

        const result = await getFieldSetInclusions(sourceTarget);

        expect(scanLocalFieldSetInclusionsMock).toHaveBeenCalledWith(['force-app/main/default']);
        expect(validateFieldSetInclusionsMock).toHaveBeenCalledWith({ records, malformed: [], ambiguous: [] });
        expect(result.records).toEqual(records);
        expect(result.issues).toEqual([{ severity: 'warning', rule: 'unnecessary-entity-definition-alternate' }]);
        expect(result.rules).toBe(FIELD_SET_INCLUSION_RULES);
    });

    it('does NOT throw on an empty scan — a project can legitimately have Selectors with no field set inclusions', async () => {
        scanLocalFieldSetInclusionsMock.mockReturnValue({ records: [], malformed: [], ambiguous: [] });
        validateFieldSetInclusionsMock.mockReturnValue([]);

        await expect(getFieldSetInclusions(sourceTarget)).resolves.toEqual({ records: [], issues: [], rules: FIELD_SET_INCLUSION_RULES });
    });

    it('throws At4dxCliError when the scan itself throws', async () => {
        scanLocalFieldSetInclusionsMock.mockImplementation(() => {
            throw new Error('ENOENT: no such directory');
        });

        await expect(getFieldSetInclusions(sourceTarget)).rejects.toThrow('Failed to scan the project directory for field set inclusions: ENOENT: no such directory');
    });
});

describe('getFieldSetInclusions — connected org', () => {
    it('connects, queries, validates, and returns records/issues/rules', async () => {
        const records = [{ developerName: 'Account_TierFields', sobject: 'Account', fieldsetName: 'AccountTierFields', isActive: true }];
        scanOrgFieldSetInclusionsMock.mockResolvedValue({ records, malformed: [], ambiguous: [], missing: false });
        validateFieldSetInclusionsMock.mockReturnValue([]);

        const result = await getFieldSetInclusions(orgTarget);

        expect(scanOrgFieldSetInclusionsMock).toHaveBeenCalledTimes(1);
        expect(result.records).toEqual(records);
    });

    it('throws At4dxCliError when connecting to the org fails', async () => {
        $$.SANDBOX.stub(AuthInfo, 'create').rejects(new Error('NamedOrgNotFoundError: No authorization found'));

        await expect(getFieldSetInclusions(orgTarget)).rejects.toThrow('Failed to connect to the org: NamedOrgNotFoundError: No authorization found');
    });

    it('throws At4dxCliError when the org query fails', async () => {
        scanOrgFieldSetInclusionsMock.mockRejectedValue(new Error('INVALID_SESSION_ID'));

        await expect(getFieldSetInclusions(orgTarget)).rejects.toThrow('Failed to query field set inclusions from the org: INVALID_SESSION_ID');
    });

    it('returns an empty result, not a throw, when the Custom Metadata Type is missing from the org', async () => {
        scanOrgFieldSetInclusionsMock.mockResolvedValue({ records: [], malformed: [], ambiguous: [], missing: true });

        await expect(getFieldSetInclusions(orgTarget)).resolves.toEqual({ records: [], issues: [], rules: FIELD_SET_INCLUSION_RULES });
        expect(validateFieldSetInclusionsMock).not.toHaveBeenCalled();
    });
});

describe('createSelectorFieldSetInclusion', () => {
    const input = { developerName: 'Account_TierFields', sobject: 'Account', fieldsetName: 'AccountTierFields' };

    it('resolves sourceDir from a source target and returns an ok outcome', async () => {
        const writeResult = { developerName: 'Account_TierFields', sobject: 'Account', issues: [] };
        createFieldSetInclusionMock.mockResolvedValue(writeResult);

        const outcome = await createSelectorFieldSetInclusion(input, sourceTarget);

        expect(createFieldSetInclusionMock).toHaveBeenCalledWith(input, { sourceDir: 'force-app/main/default' });
        expect(outcome).toEqual({ kind: 'ok', result: writeResult });
    });

    it('returns a blocked outcome, not a throw, when validation blocks the write', async () => {
        const issues = [{ severity: 'error', rule: 'duplicate-fieldset-name' }];
        createFieldSetInclusionMock.mockRejectedValue(new FieldSetInclusionWriteError('validation-failed', 'blocked', issues));

        const outcome = await createSelectorFieldSetInclusion(input, sourceTarget);

        expect(outcome).toEqual({ kind: 'blocked', issues });
    });

    it('throws At4dxCliError with the underlying message for a non-validation write error', async () => {
        createFieldSetInclusionMock.mockRejectedValue(new FieldSetInclusionWriteError('developer-name-already-exists', 'A field set inclusion named "X" already exists.'));

        await expect(createSelectorFieldSetInclusion(input, sourceTarget)).rejects.toThrow('A field set inclusion named "X" already exists.');
    });
});

describe('updateSelectorFieldSetInclusion', () => {
    const input = { developerName: 'Account_TierFields', isActive: false };

    it('resolves sourceDirs from a source target and returns an ok outcome — how the drawer\'s "remove" action works', async () => {
        const writeResult = { developerName: 'Account_TierFields', sobject: 'Account', issues: [] };
        updateFieldSetInclusionMock.mockResolvedValue(writeResult);

        const outcome = await updateSelectorFieldSetInclusion(input, sourceTarget);

        expect(updateFieldSetInclusionMock).toHaveBeenCalledWith(input, { sourceDirs: ['force-app/main/default'] });
        expect(outcome).toEqual({ kind: 'ok', result: writeResult });
    });

    it('returns a blocked outcome, not a throw, when validation blocks the write', async () => {
        const issues = [{ severity: 'error', rule: 'missing-sobject-reference' }];
        updateFieldSetInclusionMock.mockRejectedValue(new FieldSetInclusionWriteError('validation-failed', 'blocked', issues));

        const outcome = await updateSelectorFieldSetInclusion(input, sourceTarget);

        expect(outcome).toEqual({ kind: 'blocked', issues });
    });
});
