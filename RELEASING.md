# Releasing & Marketplace Publishing

> **Resolved (2026-08-24): the "publish reports success but nothing appears" issue was a
> wrong publisher name, not a vsce/Entra ID bug.** `extensions/simply-extension-pack/package.json`
> had `"publisher": "simply"`, but the actual Marketplace publisher is **`simplysf`**. Every
> earlier symptom is consistent with this: the Azure setup was correctly authenticating a
> real managed identity that really was a member of a publisher — just the wrong one (or one
> that doesn't publicly resolve), so `createExtension` calls didn't throw but never produced
> anything queryable under `simply.simply-extension-pack`. Confirmed fixed: a PAT-based
> publish immediately after correcting the publisher field succeeded and is live at
> `https://marketplace.visualstudio.com/items?itemName=simplysf.simply-extension-pack`.
> We're now back on `--azure-credential`, targeting the correct publisher. If it still
> silently no-ops with the publisher name definitely correct, *then* treat it as a real
> upstream issue — see "Falling back to a PAT" below.

This is a monorepo: each VS Code extension lives under `extensions/<name>/` with its own
`package.json` and `.releaserc.json`, and is versioned, packaged, and published to the
Marketplace independently of the others.

`.github/workflows/release.yml` runs on every push to `main`. It uses a build matrix —
one job per entry in `matrix.extension` — and runs `semantic-release` with
`working-directory: extensions/<name>` for each. Publishing authenticates with
**Microsoft Entra ID** (a user-assigned managed identity + GitHub OIDC federation), not a
Personal Access Token — Azure DevOps is retiring global PATs on 2026-12-01.

## Why Entra ID instead of a PAT

`vsce` supports two non-PAT auth paths:

- `--azure-credential` — Microsoft Entra ID via a service principal/managed identity with
  workload identity federation. This is what Microsoft's docs officially recommend, and
  what this repo uses.
- `--oidc` — a newer "trusted publishing" flow (GitHub → Marketplace directly, no Azure
  resource needed). As of 2026-08, this flag exists in `vsce` but is deliberately
  [hidden from `--help` as "unannounced"](https://github.com/microsoft/vscode-vsce/pull/1297),
  and the Marketplace-side config UI for it isn't broadly available yet. Not something to
  build production CI on today — worth revisiting once Microsoft formally announces it.

The identity must be a **user-assigned managed identity**, not a plain App
Registration/service principal — App Registrations hit a documented
[`InvalidAccessException`/"corporate credentials" failure](https://github.com/microsoft/vscode-vsce/issues/1023).

The federated credential trust is scoped to the `main` branch (not a gated GitHub
Environment), matching this repo's existing fully-automatic release flow — every push to
`main` publishes without manual approval.

## Why every extension needs `extends: semantic-release-monorepo`

Plain `semantic-release` analyzes every commit reachable from the branch, with no
awareness of which files a commit touched. In a monorepo that means a commit that only
changes `extensions/other-extension/**` would still look "releasable" to
`extensions/simply-extension-pack`'s `semantic-release` run — every extension would bump
and republish on every push, regardless of what actually changed.

Each extension's `.releaserc.json` starts with `"extends": "semantic-release-monorepo"`,
which patches the commit analyzer, release-notes generator, and last-release lookup to:

- only consider commits that touched files under that extension's directory, and
- resolve "last release" from tags matching that extension's own `tagFormat`
  (`simply-extension-pack-v*`, not a repo-wide `v*`).

This must be set via `extends`, not the `plugins` array, and `semantic-release` must be
run with its working directory set to the extension's own folder (the workflow does this
via `working-directory: extensions/${{ matrix.extension }}`) — it does not work from the
repo root.

> **Note:** `semantic-release-monorepo` hasn't been updated since Feb 2024. It still
> works with the `semantic-release` v25 line pinned here, but if it ever breaks against a
> future major version bump, the fallback is to hand-roll the same behavior with a
> `verifyConditions`/`analyzeCommits` step that path-filters `git log -- extensions/<name>`.

## One-time Azure setup

One managed identity is enough for every extension in this repo **as long as they all
publish under the same Marketplace publisher** (`simplysf`) — the identity is a member of
the publisher account, not tied to a single extension. If a future extension needs to
publish under a different publisher, give it its own managed identity and its own
`AZURE_CLIENT_ID`/`AZURE_TENANT_ID`, then reference them per-extension via a
`matrix.include` in `release.yml` instead of the single `vars.AZURE_CLIENT_ID` used today.

### 1. Create a resource group for the identity

Portal: **Resource groups → Create**
- Name: `rg-marketplace-identities`
- Region: any (holds no billable resources)

### 2. Create the user-assigned managed identity

Portal: search **"Managed Identities" → Create**
- Resource group: `rg-marketplace-identities`
- Name: `visualstudio-simplysf-simply-vscode`

### 3. Assign it the Reader role, scoped to the resource group

Open the resource group `rg-marketplace-identities` → **Access control (IAM) → Add role
assignment**
- Role: `Reader`
- Members: **Managed identity** → your subscription → "User-assigned managed identity" →
  `visualstudio-simplysf-simply-vscode`

### 4. Add the federated credential

Open the managed identity → **Settings → Federated credentials → Add credential**
- Scenario: **GitHub Actions deploying Azure resources**
- Organization: `SimplySF`
- Repository: `simply-vscode`
- Entity type: **Branch**
- Branch name: `main`
- Name: `github-actions-main`

### 5. Record the Client ID and Tenant ID

Managed identity → **Overview** → copy **Client ID** and **Tenant ID**.

### Equivalent Azure CLI

```bash
az group create -n rg-marketplace-identities -l eastus

az identity create \
  -g rg-marketplace-identities \
  -n visualstudio-simplysf-simply-vscode

# grab clientId, tenantId, principalId
az identity show \
  -g rg-marketplace-identities \
  -n visualstudio-simplysf-simply-vscode \
  --query '{clientId:clientId, tenantId:tenantId, principalId:principalId}' -o json

# scope Reader to the resource group
RG_ID=$(az group show -n rg-marketplace-identities --query id -o tsv)
PRINCIPAL_ID=$(az identity show -g rg-marketplace-identities -n visualstudio-simplysf-simply-vscode --query principalId -o tsv)
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role Reader \
  --scope "$RG_ID"

# federated credential
az identity federated-credential create \
  --name github-actions-main \
  --identity-name visualstudio-simplysf-simply-vscode \
  --resource-group rg-marketplace-identities \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:SimplySF/simply-vscode:ref:refs/heads/main \
  --audiences api://AzureADTokenExchange
```

## GitHub repo configuration

Repo → **Settings → Secrets and variables → Actions → Variables tab → New repository
variable**:

- `AZURE_CLIENT_ID` = the Client ID from step 5
- `AZURE_TENANT_ID` = the Tenant ID from step 5

These are **Variables, not Secrets** — a Client ID/Tenant ID are identifiers, not
credentials, and grant no access on their own. The actual security boundary is the
federated credential trust (which repo/branch can claim the identity) plus the
Marketplace publisher membership below.

Once this is confirmed working (see "Verifying" below), delete the old `VSCE_PAT`
repository secret — it's no longer used.

## Marketplace: add the identity as a publisher member

The Marketplace identifies members by an internal ID that is **not** the Client ID,
Tenant ID, or Resource ID. You have to look it up once.

### 1. Look up the Marketplace identity ID

Temporarily add a `workflow_dispatch`-triggered job (in this repo, or a scratch repo with
its own matching federated credential) that runs:

```yaml
name: Determine Marketplace Identity

on:
  workflow_dispatch:

jobs:
  identity:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - uses: azure/login@v3
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          allow-no-subscriptions: true
      - run: az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me --resource 499b84ac-1321-427f-aa17-267ca6975798
```

(That resource GUID is Azure DevOps's well-known app ID — safe to hardcode, same for
everyone.)

Run it via **Actions → Determine Marketplace Identity → Run workflow**, then copy the
`id` field from the JSON output in the job log. Delete this workflow file afterward.

### 2. Add the identity as a publisher member

Go to `https://marketplace.visualstudio.com/manage/publishers/simplysf` → **Members → Add**,
paste the `id` from step 1, and assign it the **Contributor** role.

> **Creator is not enough if the extension already exists.** We initially used Creator and
> hit `Access Denied: ... needs the following permission(s) on the resource
> /simplysf/simply-extension-pack to perform this action: Make changes to, share, or view
> certificate of an existing extension` when publishing a version update. Creator appears to
> only cover extensions the identity itself originates; publishing new versions of an
> extension that already existed before the identity was added (e.g. one first published via
> a human's PAT) needs Contributor.

> If you previously added the identity to a publisher named `simply` (an earlier, incorrect
> publisher reference), that membership is harmless to leave in place but doesn't grant
> access to `simplysf` — add it here too. Double-check the identity actually appears under
> `simplysf`'s Members list, not just `simply`'s.

## Verifying

Push a conventional-commit change under `extensions/simply-extension-pack/` to `main` and
watch the `release` workflow's `simply-extension-pack` matrix job run. On success, the new
version appears at
`https://marketplace.visualstudio.com/items?itemName=simplysf.simply-extension-pack`.

### Troubleshooting

| Error | Cause |
|---|---|
| `AADSTS70021: No matching federated identity record found` | Federated credential subject doesn't match — check org/repo/branch spelling |
| `Error: Could not get OIDC token` | Missing `id-token: write` permission on the job |
| `403 Forbidden` from Marketplace | Identity isn't a publisher member yet, or lacks the `Reader` role in Azure |
| `Access Denied: ... needs the following permission(s) ... Make changes to, share, or view certificate of an existing extension` | Identity's publisher role is `Creator`, which doesn't cover updating an extension it didn't originate. Change it to `Contributor`. |
| `--azure-credential is not a valid option` | `@vscode/vsce` too old (needs >= 2.26.1) |
| Extension released even though only another extension's files changed | `.releaserc.json` is missing `"extends": "semantic-release-monorepo"`, or the workflow isn't setting `working-directory` for that job |
| `vsce publish --azure-credential` logs "Published" with no error, but the extension never appears on the Marketplace (confirm via the gallery API below, or a 404 on the Hub URL) | Double-check `manifest.publisher` in `package.json` matches the *actual* Marketplace publisher slug exactly — this was the root cause on 2026-08-24 (see the note at the top of this file) and produces exactly this symptom. If the publisher name is confirmed correct and this still happens, that would indicate a genuine upstream issue; fall back to a PAT (below) to unblock rather than re-debugging from scratch. |
| Extension published under the wrong/unexpected publisher | `manifest.publisher` in the extension's `package.json` doesn't match the Marketplace publisher you intended — this field is case-sensitive and isn't validated against your Azure setup at all. |

To check the Marketplace's actual state directly (bypasses any browser/CDN caching) —
substitute the real publisher name, not `simply`:

```bash
curl -s -X POST "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json;api-version=3.0-preview.1" \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"simplysf.simply-extension-pack"}]}],"flags":914}'
```

`"TotalCount":0` means the Marketplace genuinely has no record of it, regardless of what `vsce` printed.

## Falling back to a PAT

If `--azure-credential` is ever unreliable again, fall back to a classic Personal Access
Token. This does **not** require undoing the Azure managed identity setup — that stays in
place for when Entra ID publishing is working.

### 1. Generate a PAT

1. Go to `https://dev.azure.com/` → sign in with an account that's a member of the
   `simplysf` publisher → **User settings (top right) → Personal access tokens → New Token**.
2. Organization: **All accessible organizations**.
3. Scopes: **Custom defined** → **Marketplace** → check **Manage**.
4. Set an expiration (PATs max out around 1 year; note Azure DevOps retires *global* PATs
   entirely on 2026-12-01 regardless of what you set here — this is a stop-gap, not a
   long-term fix).
5. Copy the generated token — it's shown only once.

### 2. Add it to GitHub

Repo → **Settings → Secrets and variables → Actions → Secrets tab → New repository
secret** → name `VSCE_PAT`, value the token from step 1. Unlike the Client/Tenant IDs,
this genuinely is a secret — use the **Secrets** tab, not Variables. Double check the value
actually saved — an empty/missing `VSCE_PAT` doesn't fail cleanly; it gets silently dropped
by bash word-splitting in `publishCmd` and produces a confusing `Invalid version ...vsix`
error instead.

### 3. Switch the code back to PAT mode

- `.github/workflows/release.yml`: remove the `azure/login` step and the `id-token: write`
  permission; add `VSCE_PAT: ${{ secrets.VSCE_PAT }}` to the `npx semantic-release` step's
  `env:` block.
- `extensions/simply-extension-pack/.releaserc.json`: change `publishCmd` to
  `npx vsce publish -p $VSCE_PAT --packagePath simply-extension-pack-${nextRelease.version}.vsix`.

### 4. Clear any stuck tag and retry

If a previous run pushed a release commit/tag without actually publishing, semantic-release
will think that version already shipped. Find the latest `simply-extension-pack-v*` tag and
clear it before retrying:

```bash
git tag -d simply-extension-pack-v<version>
git push origin :refs/tags/simply-extension-pack-v<version>
```

Then trigger the workflow (**Actions → release → Run workflow**, or push a commit). Verify
with the `curl` gallery-API check above, not just the `vsce` CLI output.

## Adding a new extension

1. Create `extensions/<name>/` with its own `package.json` (see
   `extensions/simply-extension-pack/package.json` for the shape — `name`, `displayName`,
   `publisher`, `version`, `engines`, `repository.directory`, etc.). Extension-specific
   `package.json` should **not** list `devDependencies` like `vsce`/`semantic-release` —
   those are shared, hoisted root `devDependencies` via npm workspaces.
2. Add its own `.releaserc.json`, copying `extensions/simply-extension-pack/.releaserc.json`
   and updating the `tagFormat` to `<name>-v${version}` and any `${nextRelease.version}`
   filename references to `<name>`.
3. Add `<name>` to the `matrix.extension` list in `.github/workflows/release.yml`.
4. Add a debug configuration for it in `.vscode/launch.json`.
5. If it publishes under a different Marketplace publisher than `simplysf`, set up a
   separate managed identity (see "One-time Azure setup" above) and wire its
   client/tenant IDs into the workflow via `matrix.include` instead of the shared
   `vars.AZURE_CLIENT_ID`.
6. Set up its unit-test harness — a sibling `test/` directory (not colocated `*.test.ts`
   files), `test/tsconfig.json`, `vitest.config.mts`, and the `test`/`test:watch`/
   `test:coverage` npm scripts — copying `extensions/simply-at4dx`'s as a starting point.
   See `docs/design/0010-automated-test-harness.md` for why this is per-extension
   `devDependencies` (like `esbuild`/`typescript`, not root-shared like `vsce`/
   `semantic-release`) and what each script does. Add `npm run test -w extensions/<name>`
   to `.github/workflows/ci.yml`, alongside the existing `compile` step.
