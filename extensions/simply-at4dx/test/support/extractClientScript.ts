import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Pulls the webview's `CLIENT_SCRIPT` template-literal body out of `domainProcessBindingPanel.ts`'s
 * source text, so it can be evaluated against a real DOM in a test — see
 * docs/design/0010-automated-test-harness.md's "Testing the webview script". `CLIENT_SCRIPT` is
 * deliberately plain, uncompiled JS injected verbatim into the generated webview HTML (see 0001's
 * Alternatives considered), not a real module a test could `import` directly.
 *
 * Throws an explicit, actionable error rather than returning an empty/wrong string if the marker text
 * ever moves — a silently-empty extraction would make every test in
 * `domainProcessBindingClientScript.test.ts` either vacuously pass or fail with a confusing DOM-shape
 * error instead of pointing at the actual cause.
 */
export function extractClientScript(): string {
    const sourcePath = path.join(__dirname, '../../src/domainProcessBindingPanel.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    const marker = 'const CLIENT_SCRIPT = `';
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
        throw new Error(
            `extractClientScript: could not find "${marker}" in ${sourcePath} — did domainProcessBindingPanel.ts change shape?`,
        );
    }

    const bodyStart = markerIndex + marker.length;
    const bodyEnd = source.indexOf('`;', bodyStart);
    if (bodyEnd === -1) {
        throw new Error(`extractClientScript: found the CLIENT_SCRIPT marker in ${sourcePath} but not its closing backtick.`);
    }

    return source.slice(bodyStart, bodyEnd);
}
