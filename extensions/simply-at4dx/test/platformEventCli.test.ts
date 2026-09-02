import { AuthInfo } from '@salesforce/core';
import { MockTestOrgData, TestContext } from '@salesforce/core/testSetup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubscription, getPlatformEventSubscriptions, simulatePlatformEventDistribution, updateSubscription } from '../src/platformEventCli';
import type { BindingSource } from '../src/at4dxCli';

// Same dynamic-`import()` mocking approach `at4dxCli.test.ts`/`applicationFactoryCli.test.ts` already
// validated — see `at4dxCli.test.ts`'s own comment and docs/design/0010's spike.
const {
    scanLocalPlatformEventSubscriptionsMock,
    scanOrgPlatformEventSubscriptionsMock,
    validatePlatformEventSubscriptionsMock,
    resolvePlatformEventDistributionMock,
    createPlatformEventSubscriptionMock,
    updatePlatformEventSubscriptionMock,
    PlatformEventSubscriptionWriteError,
} = vi.hoisted(() => {
    class PlatformEventSubscriptionWriteError extends Error {
        public constructor(
            public readonly code: string,
            message: string,
            public readonly issues?: unknown[],
        ) {
            super(message);
            this.name = 'PlatformEventSubscriptionWriteError';
        }
    }
    return {
        scanLocalPlatformEventSubscriptionsMock: vi.fn(),
        scanOrgPlatformEventSubscriptionsMock: vi.fn(),
        validatePlatformEventSubscriptionsMock: vi.fn(),
        resolvePlatformEventDistributionMock: vi.fn(),
        createPlatformEventSubscriptionMock: vi.fn(),
        updatePlatformEventSubscriptionMock: vi.fn(),
        PlatformEventSubscriptionWriteError,
    };
});

const PLATFORM_EVENT_SUBSCRIPTION_RULES = {
    'duplicate-consumer': { rule: 'duplicate-consumer', severity: 'error', scope: 'scan', title: 'Duplicate consumer', summary: 'x' },
};

vi.mock('@simplysf/simply-aep-core', () => ({
    PLATFORM_EVENT_SUBSCRIPTION_RULES,
    scanLocalPlatformEventSubscriptions: scanLocalPlatformEventSubscriptionsMock,
    scanOrgPlatformEventSubscriptions: scanOrgPlatformEventSubscriptionsMock,
    validatePlatformEventSubscriptions: validatePlatformEventSubscriptionsMock,
    resolvePlatformEventDistribution: resolvePlatformEventDistributionMock,
    createPlatformEventSubscription: createPlatformEventSubscriptionMock,
    updatePlatformEventSubscription: updatePlatformEventSubscriptionMock,
    PlatformEventSubscriptionWriteError,
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

describe('getPlatformEventSubscriptions — local source', () => {
    it('scans, validates with no eventBusFields, and returns records/malformed/issues/rules', async () => {
        const records = [{ developerName: 'AccountTierRecalc', eventBus: 'Sales_Event__e', consumer: 'AccountTierRecalcConsumer', matcherRule: 'MatchEventBusAndCategory', isActive: true, executeSynchronous: false, source: 'force-app' }];
        scanLocalPlatformEventSubscriptionsMock.mockReturnValue({ records, malformed: [] });
        validatePlatformEventSubscriptionsMock.mockReturnValue([{ severity: 'error', rule: 'duplicate-consumer' }]);

        const result = await getPlatformEventSubscriptions(sourceTarget);

        expect(scanLocalPlatformEventSubscriptionsMock).toHaveBeenCalledWith(['force-app/main/default']);
        expect(validatePlatformEventSubscriptionsMock).toHaveBeenCalledWith({ records, malformed: [] });
        expect(result.records).toBe(records);
        expect(result.issues).toEqual([{ severity: 'error', rule: 'duplicate-consumer' }]);
        expect(result.rules).toBe(PLATFORM_EVENT_SUBSCRIPTION_RULES);
    });

    it('throws At4dxCliError when the scan itself throws', async () => {
        scanLocalPlatformEventSubscriptionsMock.mockImplementation(() => {
            throw new Error('ENOENT: no such directory');
        });

        await expect(getPlatformEventSubscriptions(sourceTarget)).rejects.toThrow(
            'Failed to scan the project directory for platform event subscriptions: ENOENT: no such directory',
        );
    });

    it('does not throw on an empty scan — Platform Events can legitimately be absent from a project', async () => {
        scanLocalPlatformEventSubscriptionsMock.mockReturnValue({ records: [], malformed: [] });
        validatePlatformEventSubscriptionsMock.mockReturnValue([]);

        const result = await getPlatformEventSubscriptions(sourceTarget);

        expect(result.records).toEqual([]);
        expect(result.issues).toEqual([]);
    });
});

describe('getPlatformEventSubscriptions — connected org', () => {
    it('connects, scans, validates, and returns records/malformed/issues/rules', async () => {
        const records = [{ developerName: 'X', eventBus: 'Ops_Event__e', consumer: 'XConsumer', matcherRule: 'MatchEventBus', isActive: true, executeSynchronous: true, source: 'test' }];
        scanOrgPlatformEventSubscriptionsMock.mockResolvedValue({ records, malformed: [], missing: false });
        validatePlatformEventSubscriptionsMock.mockReturnValue([]);

        const result = await getPlatformEventSubscriptions(orgTarget);

        expect(scanOrgPlatformEventSubscriptionsMock).toHaveBeenCalledTimes(1);
        expect(result.records).toBe(records);
    });

    it('throws At4dxCliError when connecting to the org fails', async () => {
        $$.SANDBOX.stub(AuthInfo, 'create').rejects(new Error('NamedOrgNotFoundError: No authorization found'));

        await expect(getPlatformEventSubscriptions(orgTarget)).rejects.toThrow('Failed to connect to the org: NamedOrgNotFoundError: No authorization found');
    });

    it('throws At4dxCliError when the org query fails', async () => {
        scanOrgPlatformEventSubscriptionsMock.mockRejectedValue(new Error('INVALID_SESSION_ID'));

        await expect(getPlatformEventSubscriptions(orgTarget)).rejects.toThrow('Failed to query platform event subscriptions from the org: INVALID_SESSION_ID');
    });

    it("treats a missing CMDT as empty, not an error — this AT4DX family is optional infra some orgs don't have", async () => {
        scanOrgPlatformEventSubscriptionsMock.mockResolvedValue({ records: [], malformed: [], missing: true });

        await expect(getPlatformEventSubscriptions(orgTarget)).resolves.toEqual({ records: [], malformed: [], issues: [], rules: PLATFORM_EVENT_SUBSCRIPTION_RULES });
        expect(validatePlatformEventSubscriptionsMock).not.toHaveBeenCalled();
    });
});

describe('simulatePlatformEventDistribution', () => {
    it('delegates straight to the library, with no org round trip', async () => {
        const input = { eventBus: 'Sales_Event__e', category: 'Account' };
        const records = [{ developerName: 'X' }] as never;
        const libraryResult = { input, matches: [], misses: [] };
        resolvePlatformEventDistributionMock.mockReturnValue(libraryResult);

        const result = await simulatePlatformEventDistribution(input, records);

        expect(resolvePlatformEventDistributionMock).toHaveBeenCalledWith(input, records);
        expect(result).toBe(libraryResult);
    });
});

describe('createSubscription', () => {
    const input = { developerName: 'AccountTierRecalc', eventBus: 'Sales_Event__e', consumer: 'AccountTierRecalcConsumer', matcherRule: 'MatchEventBusAndCategory' as const };

    it('resolves sourceDir from a source target and returns an ok outcome', async () => {
        const writeResult = { developerName: 'AccountTierRecalc', eventBus: 'Sales_Event__e', consumer: 'AccountTierRecalcConsumer', issues: [] };
        createPlatformEventSubscriptionMock.mockResolvedValue(writeResult);

        const outcome = await createSubscription(input, sourceTarget);

        expect(createPlatformEventSubscriptionMock).toHaveBeenCalledWith(input, { sourceDir: 'force-app/main/default' });
        expect(outcome).toEqual({ kind: 'ok', result: writeResult });
    });

    it('returns a blocked outcome, not a throw, when validation blocks the write', async () => {
        const issues = [{ severity: 'error', rule: 'matcher-rule-missing-field' }];
        createPlatformEventSubscriptionMock.mockRejectedValue(new PlatformEventSubscriptionWriteError('validation-failed', 'blocked', issues));

        const outcome = await createSubscription(input, sourceTarget);

        expect(outcome).toEqual({ kind: 'blocked', issues });
    });

    it('throws At4dxCliError with the underlying message for a non-validation write error', async () => {
        createPlatformEventSubscriptionMock.mockRejectedValue(new PlatformEventSubscriptionWriteError('developer-name-already-exists', 'A subscription named "X" already exists.'));

        await expect(createSubscription(input, sourceTarget)).rejects.toThrow('A subscription named "X" already exists.');
    });

    it('adds a "nothing was saved" clarification for a deploy failure', async () => {
        createPlatformEventSubscriptionMock.mockRejectedValue(new PlatformEventSubscriptionWriteError('deploy-failed', 'Failed to deploy the record: boom'));

        await expect(createSubscription(input, orgTarget)).rejects.toThrow(/nothing was saved to local source or left in the org/);
    });
});

describe('updateSubscription', () => {
    const input = { developerName: 'AccountTierRecalc', isActive: false };

    it('resolves sourceDirs from a source target (search scope, not a single destination) and returns an ok outcome', async () => {
        const writeResult = { developerName: 'AccountTierRecalc', eventBus: 'Sales_Event__e', consumer: 'AccountTierRecalcConsumer', issues: [] };
        updatePlatformEventSubscriptionMock.mockResolvedValue(writeResult);

        const outcome = await updateSubscription(input, sourceTarget);

        expect(updatePlatformEventSubscriptionMock).toHaveBeenCalledWith(input, { sourceDirs: ['force-app/main/default'] });
        expect(outcome).toEqual({ kind: 'ok', result: writeResult });
    });

    it('returns a blocked outcome for a validation-failed error', async () => {
        const issues = [{ severity: 'error', rule: 'duplicate-consumer' }];
        updatePlatformEventSubscriptionMock.mockRejectedValue(new PlatformEventSubscriptionWriteError('validation-failed', 'blocked', issues));

        const outcome = await updateSubscription(input, sourceTarget);

        expect(outcome).toEqual({ kind: 'blocked', issues });
    });

    it('throws At4dxCliError when the developer name is not found', async () => {
        updatePlatformEventSubscriptionMock.mockRejectedValue(new PlatformEventSubscriptionWriteError('developer-name-not-found', 'No PlatformEvents_Subscription__mdt record named "X" was found.'));

        await expect(updateSubscription(input, sourceTarget)).rejects.toThrow('No PlatformEvents_Subscription__mdt record named "X" was found.');
    });
});
