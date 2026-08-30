const esbuild = require('esbuild');
const esbuildSvelte = require('esbuild-svelte');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    const extensionCtx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode'],
        logLevel: 'warning',
    });

    // Compiles the webview's Svelte component tree into the single browser-side bundle
    // `at4dxExplorerPanel.ts` loads via `webview.asWebviewUri()` — see docs/design/0011.
    // `css: 'injected'` keeps every component's styles bundled into this one JS file (injected as
    // `<style>` elements at mount time) rather than emitting a second `dist/webview.css` output, so
    // the panel's CSP doesn't need `style-src` widened beyond the `'unsafe-inline'` it already has.
    const webviewCtx = await esbuild.context({
        entryPoints: ['src/webview/main.ts'],
        bundle: true,
        format: 'iife',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'browser',
        outfile: 'dist/webview.js',
        logLevel: 'warning',
        plugins: [esbuildSvelte({ compilerOptions: { css: 'injected' } })],
    });

    if (watch) {
        await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
    } else {
        await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
        await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
