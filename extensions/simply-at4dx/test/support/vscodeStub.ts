/**
 * A minimal fake of the `vscode` module surface this extension's *testable* code actually touches.
 * `vscode` is a virtual module the real VS Code extension host injects at runtime — it isn't an
 * installable npm package, so it can't be resolved by a plain Node test process at all. Aliased in for
 * every test via `vitest.config.ts`'s `resolve.alias`, so any file that does `import * as vscode from
 * 'vscode'` (even one only exercising code paths that never call into it, like `logger.ts`'s pure
 * `truncate`/`redactProxyUrl`) can still be imported.
 *
 * Deliberately small: only `Uri.file`, the one runtime call `resolveDefaultSourceDir` makes today. Grow
 * this as more `vscode`-touching code gets covered — see docs/design/0010-automated-test-harness.md's
 * Decision for what this tier does and doesn't cover.
 */
export class Uri {
    private constructor(public readonly fsPath: string) {}

    static file(fsPath: string): Uri {
        return new Uri(fsPath);
    }

    toString(): string {
        return `file://${this.fsPath}`;
    }
}
