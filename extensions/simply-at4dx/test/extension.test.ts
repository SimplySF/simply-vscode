import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { resolveDefaultSourceDir } from '../src/extension';

// `SfProject.resolve` is the one call `resolveDefaultSourceDir` makes into `@salesforce/core` — mocked
// per-test below so each of the three fallback rules (package directory, sfdx-source/force-app,
// workspace root) can be exercised independently of a real sfdx-project.json. `AuthInfo` isn't used by
// the function under test, but `extension.ts` imports it statically alongside `SfProject`, so the mock
// factory needs to provide something in its place.
const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));
vi.mock('@salesforce/core', () => ({
    AuthInfo: {},
    SfProject: { resolve: resolveMock },
}));

describe('resolveDefaultSourceDir', () => {
    let workspacePath: string;

    beforeEach(() => {
        workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'simply-at4dx-resolve-default-source-dir-'));
        resolveMock.mockReset();
    });

    afterEach(() => {
        fs.rmSync(workspacePath, { force: true, recursive: true });
    });

    function workspaceFolder(): vscode.WorkspaceFolder {
        return { uri: { fsPath: workspacePath } } as vscode.WorkspaceFolder;
    }

    it("resolves the sfdx-project.json default package directory when it exists on disk", async () => {
        const packageDir = path.join(workspacePath, 'sfdx-source', 'core');
        fs.mkdirSync(packageDir, { recursive: true });
        resolveMock.mockResolvedValue({ getDefaultPackage: () => ({ fullPath: packageDir }) });

        const result = await resolveDefaultSourceDir(workspaceFolder());

        expect(result.fsPath).toBe(packageDir);
    });

    it('falls back to sfdx-source when the resolved package directory is missing on disk', async () => {
        const missingPackageDir = path.join(workspacePath, 'does-not-exist');
        const sfdxSource = path.join(workspacePath, 'sfdx-source');
        fs.mkdirSync(sfdxSource);
        resolveMock.mockResolvedValue({ getDefaultPackage: () => ({ fullPath: missingPackageDir }) });

        const result = await resolveDefaultSourceDir(workspaceFolder());

        expect(result.fsPath).toBe(sfdxSource);
    });

    it('falls back to sfdx-source when SfProject.resolve throws (no sfdx-project.json)', async () => {
        const sfdxSource = path.join(workspacePath, 'sfdx-source');
        fs.mkdirSync(sfdxSource);
        resolveMock.mockRejectedValue(new Error('no sfdx-project.json found'));

        const result = await resolveDefaultSourceDir(workspaceFolder());

        expect(result.fsPath).toBe(sfdxSource);
    });

    it('prefers sfdx-source over force-app when both exist', async () => {
        fs.mkdirSync(path.join(workspacePath, 'sfdx-source'));
        fs.mkdirSync(path.join(workspacePath, 'force-app'));
        resolveMock.mockRejectedValue(new Error('no sfdx-project.json found'));

        const result = await resolveDefaultSourceDir(workspaceFolder());

        expect(result.fsPath).toBe(path.join(workspacePath, 'sfdx-source'));
    });

    it('falls back to force-app when sfdx-source is absent', async () => {
        fs.mkdirSync(path.join(workspacePath, 'force-app'));
        resolveMock.mockRejectedValue(new Error('no sfdx-project.json found'));

        const result = await resolveDefaultSourceDir(workspaceFolder());

        expect(result.fsPath).toBe(path.join(workspacePath, 'force-app'));
    });

    it('falls back to the workspace root when nothing else resolves', async () => {
        resolveMock.mockRejectedValue(new Error('no sfdx-project.json found'));

        const result = await resolveDefaultSourceDir(workspaceFolder());

        expect(result.fsPath).toBe(workspacePath);
    });
});
