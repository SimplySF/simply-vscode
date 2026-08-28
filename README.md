# Simply VS Code Extensions

Monorepo for SimplySF's Visual Studio Code extensions. Each extension lives in its own
directory under `extensions/` and is versioned, packaged, and published to the
Marketplace independently.

## Extensions

| Extension | Path | Marketplace |
|---|---|---|
| Simply Extension Pack | [`extensions/simply-extension-pack`](extensions/simply-extension-pack) | [simply.simply-extension-pack](https://marketplace.visualstudio.com/items?itemName=simply.simply-extension-pack) |
| Simply AT4DX | [`extensions/simply-at4dx`](extensions/simply-at4dx) | [simplysf.simply-at4dx](https://marketplace.visualstudio.com/items?itemName=simplysf.simply-at4dx) |

## Development

This repo uses npm workspaces. From the repo root:

```bash
npm ci
```

installs dependencies for every extension. To debug a specific extension in VS Code,
open the repo root as your workspace and use its launch configuration in
`.vscode/launch.json` (press `F5`).

## Design documents

Every new extension, and any user-visible change to an existing one (a new command, a UI or behavior
change, a change to how an extension gets its data), gets a design document in
[`docs/design/`](docs/design/README.md) **before** it gets code. See that README for the process, the
template, and the index of existing docs — the point is that the reasoning behind an extension's
shape stays recoverable later instead of dying in PR threads.

## Adding a new extension

1. Write its first design doc in `docs/design/` (see above) and get it agreed on.
2. Create `extensions/<name>/` with its own `package.json`, `.releaserc.json`, and
   extension source — see `extensions/simply-extension-pack` as a template.
3. Add `<name>` to the `matrix.extension` list in `.github/workflows/release.yml`.
4. Add a launch configuration for it in `.vscode/launch.json`.

See [RELEASING.md](RELEASING.md) for full details on the release pipeline and
Marketplace publishing setup.
