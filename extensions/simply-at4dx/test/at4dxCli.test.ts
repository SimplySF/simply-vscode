import { AuthInfo } from '@salesforce/core';
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { At4dxCliError, createBinding, getDomainProcessBindings, setBinding, type BindingSource } from '../src/at4dxCli';

// `at4dxCli.ts` loads `@simplysf/simply-aep-core` via a dynamic `await import(...)` (it's ESM-only —
// see that file's own comment). Vitest's `vi.mock` operates at module-resolution time, the same
// mechanism its dev-server transform uses to serve modules, so it intercepts a dynamic import the same
// as a static one — confirmed by every test below actually exercising the mocked functions rather than
// the real package. This is docs/design/0010's spike, folded into the real suite rather than a
// throwaway file, since the fastest way to prove the assumption is to write the tests that depend on it.
const {
    scanLocalDomainProcessBindingsMock,
    scanOrgDomainProcessBindingsMock,
    resolveDomainProcessBindingsMock,
    validateDomainProcessBindingsMock,
    createDomainProcessBindingMock,
    setDomainProcessBindingMock,
    DomainProcessBindingWriteError,
} = vi.hoisted(() => {
    class DomainProcessBindingWriteError extends Error {
        public constructor(
            public readonly code: string,
            message: string,
            public readonly issues?: unknown[],
        ) {
            super(message);
            this.name = 'DomainProcessBindingWriteError';
        }
    }
    return {
        scanLocalDomainProcessBindingsMock: vi.fn(),
        scanOrgDomainProcessBindingsMock: vi.fn(),
        resolveDomainProcessBindingsMock: vi.fn(),
        validateDomainProcessBindingsMock: vi.fn(),
        createDomainProcessBindingMock: vi.fn(),
        setDomainProcessBindingMock: vi.fn(),
        DomainProcessBindingWriteError,
    };
});

const DOMAIN_PROCESS_BINDING_RULES = { 'order-collision': { rule: 'order-collision', severity: 'error', scope: 'record', title: 'Order collision', summary: 'x' } };

vi.mock('@simplysf/simply-aep-core', () => ({
    scanLocalDomainProcessBindings: scanLocalDomainProcessBindingsMock,
    scanOrgDomainProcessBindings: scanOrgDomainProcessBindingsMock,
    resolveDomainProcessBindings: resolveDomainProcessBindingsMock,
    validateDomainProcessBindings: validateDomainProcessBindingsMock,
    DOMAIN_PROCESS_BINDING_RULES,
    createDomainProcessBinding: createDomainProcessBindingMock,
    // Renamed upstream from `setDomainProcessBinding` (`simply-aep-core` v0.10) — `at4dxCli.ts`'s own
    // `setBinding` wrapper aliases it back locally, see that file's import comment.
    updateDomainProcessBinding: setDomainProcessBindingMock,
    DomainProcessBindingWriteError,
}));

const sourceTarget: BindingSource = { kind: 'source', dirs: ['force-app/main/default'] };

// One org, faked via @salesforce/core/testSetup (the same approach simply-aep-core's own tests use for
// AuthInfo/Connection — see docs/design/0010's Decision), shared across every describe block below that
// needs an org target, rather than each re-deriving its own.
const $$ = new TestContext();
let orgTarget: BindingSource;

beforeEach(async () => {
    vi.clearAllMocks();
    const testOrg = new MockTestOrgData();
    await $$.stubAuths(testOrg);
    orgTarget = { kind: 'org', username: await testOrg.username };
});

describe('getDomainProcessBindings — local source', () => {
    it('scans, validates, resolves, and returns rows/issues/rules', async () => {
        const records = [{ developerName: 'Account_Before_Insert_Test', sobject: 'Account' }];
        scanLocalDomainProcessBindingsMock.mockReturnValue({ records, malformed: [] });
        validateDomainProcessBindingsMock.mockReturnValue([{ severity: 'warning', rule: 'order-collision' }]);
        resolveDomainProcessBindingsMock.mockReturnValue([{ developerName: 'Account_Before_Insert_Test', sobject: 'Account', orderCollision: false }]);

        const result = await getDomainProcessBindings(sourceTarget);

        expect(scanLocalDomainProcessBindingsMock).toHaveBeenCalledWith(['force-app/main/default']);
        expect(validateDomainProcessBindingsMock).toHaveBeenCalledWith({ records, malformed: [] });
        expect(resolveDomainProcessBindingsMock).toHaveBeenCalledWith(records);
        expect(result.rows).toEqual([{ developerName: 'Account_Before_Insert_Test', sobject: 'Account', orderCollision: false }]);
        expect(result.issues).toEqual([{ severity: 'warning', rule: 'order-collision' }]);
        expect(result.rules).toBe(DOMAIN_PROCESS_BINDING_RULES);
    });

    it('applies the sobjects filter before resolving', async () => {
        const records = [
            { developerName: 'Account_Test', sobject: 'Account' },
            { developerName: 'Contact_Test', sobject: 'Contact' },
        ];
        scanLocalDomainProcessBindingsMock.mockReturnValue({ records, malformed: [] });
        validateDomainProcessBindingsMock.mockReturnValue([]);
        resolveDomainProcessBindingsMock.mockReturnValue([]);

        await getDomainProcessBindings(sourceTarget, ['Account']);

        expect(resolveDomainProcessBindingsMock).toHaveBeenCalledWith([{ developerName: 'Account_Test', sobject: 'Account' }]);
    });

    it('throws At4dxCliError when the scan itself throws', async () => {
        scanLocalDomainProcessBindingsMock.mockImplementation(() => {
            throw new Error('ENOENT: no such directory');
        });

        await expect(getDomainProcessBindings(sourceTarget)).rejects.toThrow('Failed to scan the project directory: ENOENT: no such directory');
    });

    it('throws the at4dxNotDetected message when the scan finds nothing', async () => {
        scanLocalDomainProcessBindingsMock.mockReturnValue({ records: [], malformed: [] });

        await expect(getDomainProcessBindings(sourceTarget)).rejects.toThrow(/DomainProcessBinding__mdt Custom Metadata Type wasn't found/);
    });

    it('does not throw at4dxNotDetected when there are malformed records but no valid ones', async () => {
        scanLocalDomainProcessBindingsMock.mockReturnValue({ records: [], malformed: [{ developerName: 'Bad_Record' }] });
        validateDomainProcessBindingsMock.mockReturnValue([{ severity: 'error', rule: 'missing-sobject-reference' }]);
        resolveDomainProcessBindingsMock.mockReturnValue([]);

        const result = await getDomainProcessBindings(sourceTarget);

        expect(result.rows).toEqual([]);
        expect(result.issues).toEqual([{ severity: 'error', rule: 'missing-sobject-reference' }]);
    });
});

describe('getDomainProcessBindings — connected org', () => {
    it('connects, scans, validates, resolves, and returns rows/issues/rules', async () => {
        const records = [{ developerName: 'Account_Before_Insert_Test', sobject: 'Account' }];
        scanOrgDomainProcessBindingsMock.mockResolvedValue({ records, malformed: [], missing: false });
        validateDomainProcessBindingsMock.mockReturnValue([]);
        resolveDomainProcessBindingsMock.mockReturnValue([{ developerName: 'Account_Before_Insert_Test', sobject: 'Account' }]);

        const result = await getDomainProcessBindings(orgTarget);

        expect(scanOrgDomainProcessBindingsMock).toHaveBeenCalledTimes(1);
        expect(result.rows).toEqual([{ developerName: 'Account_Before_Insert_Test', sobject: 'Account' }]);
    });

    it('throws At4dxCliError when connecting to the org fails', async () => {
        $$.SANDBOX.stub(AuthInfo, 'create').rejects(new Error('NamedOrgNotFoundError: No authorization found'));

        await expect(getDomainProcessBindings(orgTarget)).rejects.toThrow('Failed to connect to the org: NamedOrgNotFoundError: No authorization found');
    });

    it('throws At4dxCliError when the org query fails', async () => {
        scanOrgDomainProcessBindingsMock.mockRejectedValue(new Error('INVALID_SESSION_ID'));

        await expect(getDomainProcessBindings(orgTarget)).rejects.toThrow('Failed to query bindings from the org: INVALID_SESSION_ID');
    });

    it('throws the at4dxNotDetected message when the org reports the type missing', async () => {
        scanOrgDomainProcessBindingsMock.mockResolvedValue({ records: [], malformed: [], missing: true });

        await expect(getDomainProcessBindings(orgTarget)).rejects.toThrow(/DomainProcessBinding__mdt Custom Metadata Type wasn't found/);
    });
});

describe('createBinding', () => {
    const input = {
        developerName: 'Account_Before_Insert_Test',
        sobject: 'Account',
        processContext: 'TriggerExecution' as const,
        triggerOperation: 'Before_Insert' as const,
        type: 'Action' as const,
        classToInject: 'SomeAction',
        order: 10,
    };

    it('resolves sourceDir from a source target and returns an ok outcome', async () => {
        const writeResult = { developerName: 'Account_Before_Insert_Test', sobject: 'Account', issues: [] };
        createDomainProcessBindingMock.mockResolvedValue(writeResult);

        const outcome = await createBinding(input, sourceTarget);

        expect(createDomainProcessBindingMock).toHaveBeenCalledWith(input, { sourceDir: 'force-app/main/default' });
        expect(outcome).toEqual({ kind: 'ok', result: writeResult });
    });

    it('returns a blocked outcome, not a throw, when validation blocks the write', async () => {
        const issues = [{ severity: 'error', rule: 'order-collision' }];
        createDomainProcessBindingMock.mockRejectedValue(new DomainProcessBindingWriteError('validation-failed', 'blocked', issues));

        const outcome = await createBinding(input, sourceTarget);

        expect(outcome).toEqual({ kind: 'blocked', issues });
    });

    it('throws At4dxCliError with the underlying message for a non-validation write error', async () => {
        createDomainProcessBindingMock.mockRejectedValue(
            new DomainProcessBindingWriteError('developer-name-already-exists', 'A binding named "X" already exists in force-app/main/default.'),
        );

        await expect(createBinding(input, sourceTarget)).rejects.toThrow('A binding named "X" already exists in force-app/main/default.');
    });

    it('appends the durability note for a deploy-failed error against an org target', async () => {
        createDomainProcessBindingMock.mockRejectedValue(new DomainProcessBindingWriteError('deploy-failed', 'Failed to deploy the binding: boom'));

        await expect(createBinding(input, orgTarget)).rejects.toThrow(
            'Failed to deploy the binding: boom The binding was not written anywhere durable — nothing was saved to local source or left in the org.',
        );
    });

    it('wraps an unexpected thrown error as At4dxCliError', async () => {
        createDomainProcessBindingMock.mockRejectedValue(new Error('disk full'));

        await expect(createBinding(input, sourceTarget)).rejects.toThrow('disk full');
    });

    it('is an instance of At4dxCliError', async () => {
        createDomainProcessBindingMock.mockRejectedValue(new Error('disk full'));

        await expect(createBinding(input, sourceTarget)).rejects.toBeInstanceOf(At4dxCliError);
    });
});

describe('setBinding', () => {
    const input = { developerName: 'Account_Before_Insert_Test', order: 20 };

    it('resolves sourceDirs from a source target (search scope, not a single destination)', async () => {
        const writeResult = { developerName: 'Account_Before_Insert_Test', sobject: 'Account', issues: [] };
        setDomainProcessBindingMock.mockResolvedValue(writeResult);

        const outcome = await setBinding(input, { kind: 'source', dirs: ['force-app/main/default', 'force-app/extra'] });

        expect(setDomainProcessBindingMock).toHaveBeenCalledWith(input, { sourceDirs: ['force-app/main/default', 'force-app/extra'] });
        expect(outcome).toEqual({ kind: 'ok', result: writeResult });
    });

    it('returns a blocked outcome for a validation-failed error', async () => {
        const issues = [{ severity: 'error', rule: 'order-collision' }];
        setDomainProcessBindingMock.mockRejectedValue(new DomainProcessBindingWriteError('validation-failed', 'blocked', issues));

        const outcome = await setBinding(input, sourceTarget);

        expect(outcome).toEqual({ kind: 'blocked', issues });
    });

    it('throws At4dxCliError when the developer name is not found', async () => {
        setDomainProcessBindingMock.mockRejectedValue(
            new DomainProcessBindingWriteError('developer-name-not-found', 'No DomainProcessBinding__mdt record named "X" was found.'),
        );

        await expect(setBinding(input, sourceTarget)).rejects.toThrow('No DomainProcessBinding__mdt record named "X" was found.');
    });
});
