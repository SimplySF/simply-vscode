/** `acquireVsCodeApi` is injected into the webview's global scope by the VS Code host runtime — not an installable package, so it's declared here rather than typed via `@types/vscode` (a Node/extension-host-only package this browser bundle never depends on). */
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

/** Acquired once at module scope — the real API throws if called a second time. */
export const vscode = acquireVsCodeApi();

export function postMessage(message: unknown): void {
    vscode.postMessage(message);
}
