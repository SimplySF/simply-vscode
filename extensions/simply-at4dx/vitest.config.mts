import * as path from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

const dirname = import.meta.dirname;

// `environment: 'node'` by default — almost none of this tier touches the DOM.
// `domainProcessBindingClientScript.test.ts` opts into jsdom itself via a
// `// @vitest-environment jsdom` comment rather than making every other test pay for it.
export default defineConfig({
    // Only used to compile `.svelte` files for component tests (`test/webview/*.test.ts`) — the actual
    // webview bundle is still built by `esbuild-svelte` (see `esbuild.js`, docs/design/0011); vitest's
    // own transform pipeline is Vite-based regardless of what bundles the shipped extension.
    plugins: [svelte()],
    resolve: {
        alias: {
            // `vscode` is a virtual module the real extension host injects — see
            // test/support/vscodeStub.ts for why this is aliased in for every test.
            vscode: path.resolve(dirname, 'test/support/vscodeStub.ts'),
        },
        // Without this, `@sveltejs/vite-plugin-svelte` compiles every `.svelte` import against
        // Svelte's server (SSR) runtime under Vitest — `mount()` then throws
        // `lifecycle_function_unavailable` the moment a component test tries to render one. Forcing
        // the `browser` export condition (the documented fix for Svelte component tests under
        // Vitest) makes it resolve the client runtime instead, matching what `esbuild.js`'s
        // `platform: 'browser'` webview build already targets.
        conditions: ['browser'],
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
            include: ['src/**/*.ts', 'src/**/*.svelte'],
            exclude: ['src/**/*.d.ts'],
        },
    },
});
