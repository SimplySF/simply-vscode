# Simply VS Code Extensions

Monorepo for SimplySF's Visual Studio Code extensions. Each extension lives in its own
directory under `extensions/` and is versioned, packaged, and published to the
Marketplace independently.

## Extensions

| Extension | Path | Marketplace |
|---|---|---|
| Simply Extension Pack | [`extensions/simply-extension-pack`](extensions/simply-extension-pack) | [simply.simply-extension-pack](https://marketplace.visualstudio.com/items?itemName=simply.simply-extension-pack) |

## Development

This repo uses npm workspaces. From the repo root:

```bash
npm ci
```

installs dependencies for every extension. To debug a specific extension in VS Code,
open the repo root as your workspace and use its launch configuration in
`.vscode/launch.json` (press `F5`).

## Adding a new extension

1. Create `extensions/<name>/` with its own `package.json`, `.releaserc.json`, and
   extension source — see `extensions/simply-extension-pack` as a template.
2. Add `<name>` to the `matrix.extension` list in `.github/workflows/release.yml`.
3. Add a launch configuration for it in `.vscode/launch.json`.

See [RELEASING.md](RELEASING.md) for full details on the release pipeline and
Marketplace publishing setup.
