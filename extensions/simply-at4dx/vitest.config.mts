import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

const dirname = import.meta.dirname;

// `environment: 'node'` by default — almost none of this tier touches the DOM.
// `domainProcessBindingClientScript.test.ts` opts into jsdom itself via a
// `// @vitest-environment jsdom` comment rather than making every other test pay for it.
export default defineConfig({
    resolve: {
        alias: {
            // `vscode` is a virtual module the real extension host injects — see
            // test/support/vscodeStub.ts for why this is aliased in for every test.
            vscode: path.resolve(dirname, 'test/support/vscodeStub.ts'),
        },
    },
    test: {
        // @salesforce/core/testSetup's TestContext registers its stub/restore hooks against the
        // global beforeEach/afterEach (a Mocha-style assumption), so these must be real globals at
        // runtime, not just imported bindings — same reasoning simply-aep-core's own vitest config
        // documents for the identical dependency.
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts'],
        },
    },
});
