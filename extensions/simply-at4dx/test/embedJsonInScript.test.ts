import { describe, expect, it } from 'vitest';
import { embedJsonInScript } from '../src/at4dxExplorerPanel';

// U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) built from character codes rather than
// written out as an escaped literal in this file's own source, so nothing here reproduces the very
// character the fix escapes. See embedJsonInScript's own doc comment in at4dxExplorerPanel.ts
// for the full story: a Description__c (or any free-text field a user types, including pasted text)
// containing either raw character broke VS Code's own webview-loading document.write with a generic
// "Invalid or unexpected token"/"Invalid regular expression" syntax error -- this is what actually
// broke the panel for real users, not the regex literals a prior fix (incorrectly) targeted.
const LINE_SEPARATOR = String.fromCharCode(8232);
const PARAGRAPH_SEPARATOR = String.fromCharCode(8233);

/** Parses `const ALL_ROWS = <embedded>;` the same way a browser's script engine would, and returns the value. */
function evalEmbedded(embedded: string): unknown {
    return new Function(`return ${embedded};`)();
}

describe('embedJsonInScript', () => {
    it('produces a plain JSON representation for ordinary values', () => {
        const embedded = embedJsonInScript({ developerName: 'Account_Before_Insert_Test', order: 10 });

        expect(evalEmbedded(embedded)).toEqual({ developerName: 'Account_Before_Insert_Test', order: 10 });
    });

    it('escapes a U+2028 LINE SEPARATOR inside a string field so the result is valid JS source', () => {
        const description = `First line${LINE_SEPARATOR}second line`;
        const embedded = embedJsonInScript({ description });

        expect(embedded.includes(LINE_SEPARATOR)).toBe(false);
        expect(() => evalEmbedded(embedded)).not.toThrow();
        expect(evalEmbedded(embedded)).toEqual({ description });
    });

    it('escapes a U+2029 PARAGRAPH SEPARATOR inside a string field so the result is valid JS source', () => {
        const description = `First paragraph${PARAGRAPH_SEPARATOR}second paragraph`;
        const embedded = embedJsonInScript({ description });

        expect(embedded.includes(PARAGRAPH_SEPARATOR)).toBe(false);
        expect(() => evalEmbedded(embedded)).not.toThrow();
        expect(evalEmbedded(embedded)).toEqual({ description });
    });

    it('escapes both separators together, and elsewhere than the first field', () => {
        const rows = [
            { developerName: 'A', description: `line one${LINE_SEPARATOR}line two` },
            { developerName: 'B', description: `para one${PARAGRAPH_SEPARATOR}para two${LINE_SEPARATOR}para three` },
        ];
        const embedded = embedJsonInScript(rows);

        expect(embedded.includes(LINE_SEPARATOR)).toBe(false);
        expect(embedded.includes(PARAGRAPH_SEPARATOR)).toBe(false);
        expect(evalEmbedded(embedded)).toEqual(rows);
    });

    it('still escapes "<" so a literal </script> in embedded data cannot close the real script tag', () => {
        const embedded = embedJsonInScript({ description: 'Danger: </script><script>alert(1)</script>' });

        expect(embedded.toLowerCase()).not.toContain('</script');
        expect(evalEmbedded(embedded)).toEqual({ description: 'Danger: </script><script>alert(1)</script>' });
    });
});
