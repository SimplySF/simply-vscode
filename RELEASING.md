# Releasing & Marketplace Publishing

> **Current status (2026-08-24): running on a classic PAT, not Entra ID.**
> `vsce publish --azure-credential` was fully wired up (managed identity, federated
> credential, publisher membership) and *reported* success, but the extension never
> actually appeared on the Marketplace — confirmed via the public gallery API and a 404 on
> the publisher hub page, even after verbose `AZURE_LOG_LEVEL=info` logging showed the
> correct identity/token/scope being used. This looks like an upstream bug in `vsce`'s
> Entra ID publish path with no client-side diagnosable cause. We reverted to a PAT
> (`VSCE_PAT` secret) to unblock publishing; the Entra ID Azure setup below is left intact
> so it can be re-enabled once the bug is understood/fixed. See "Reverting to a PAT" below
> for exactly what changed, and swap it back once `--azure-credential` is trustworthy again
> (before PATs retire on 2026-12-01).

This is a monorepo: each VS Code extension lives under `extensions/<name>/` with its own
`package.json` and `.releaserc.json`, and is versioned, packaged, and published to the
Marketplace independently of the others.

`.github/workflows/release.yml` runs on every push to `main`. It uses a build matrix —
one job per entry in `matrix.extension` — and runs `semantic-release` with
`working-directory: extensions/<name>` for each. The sections below describe the intended
**Microsoft Entra ID** setup (a user-assigned managed identity + GitHub OIDC federation) —
see the status note above for why the workflow currently uses a PAT instead.

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
publish under the same Marketplace publisher** (`simply`) — the identity is a member of
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

Go to `https://marketplace.visualstudio.com/manage/publishers/simply` → **Members → Add**,
paste the `id` from step 1, and assign it the **Creator** role (sufficient to publish;
use Contributor only if it also needs to manage existing listings).

## Verifying

Push a conventional-commit change under `extensions/simply-extension-pack/` to `main` and
watch the `release` workflow's `simply-extension-pack` matrix job run. On success, the new
version appears at
`https://marketplace.visualstudio.com/items?itemName=simply.simply-extension-pack`.

### Troubleshooting

| Error | Cause |
|---|---|
| `AADSTS70021: No matching federated identity record found` | Federated credential subject doesn't match — check org/repo/branch spelling |
| `Error: Could not get OIDC token` | Missing `id-token: write` permission on the job |
| `403 Forbidden` from Marketplace | Identity isn't a publisher member yet, or lacks the `Reader` role in Azure |
| `--azure-credential is not a valid option` | `@vscode/vsce` too old (needs >= 2.26.1) |
| Extension released even though only another extension's files changed | `.releaserc.json` is missing `"extends": "semantic-release-monorepo"`, or the workflow isn't setting `working-directory` for that job |
| `vsce publish --azure-credential` logs "Published" with no error, but the extension never appears on the Marketplace (confirm via the gallery API below, or a 404 on the Hub URL) | Unresolved upstream issue as of 2026-08-24 — see "Current status" at the top of this file. Verified NOT caused by a permission/membership/wrong-credential problem (checked with `AZURE_LOG_LEVEL=info`: `AzureCliCredential` wins with the correct scope). Fall back to a PAT (below) rather than re-debugging this from scratch. |

To check the Marketplace's actual state directly (bypasses any browser/CDN caching):

```bash
curl -s -X POST "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json;api-version=3.0-preview.1" \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"simply.simply-extension-pack"}]}],"flags":914}'
```

`"TotalCount":0` means the Marketplace genuinely has no record of it, regardless of what `vsce` printed.

## Reverting to a PAT

If `--azure-credential` is unreliable (see "Current status" above), fall back to a classic
Personal Access Token. This does **not** require undoing the Azure managed identity setup —
that stays in place for when Entra ID publishing is trustworthy again.

### 1. Generate a PAT

1. Go to `https://dev.azure.com/` → sign in with the account that's a member of the
   `simply` publisher → **User settings (top right) → Personal access tokens → New Token**.
2. Organization: **All accessible organizations**.
3. Scopes: **Custom defined** → **Marketplace** → check **Manage**.
4. Set an expiration (PATs max out around 1 year; note Azure DevOps retires *global* PATs
   entirely on 2026-12-01 regardless of what you set here — this is a stop-gap, not a
   long-term fix).
5. Copy the generated token — it's shown only once.

### 2. Add it to GitHub

Repo → **Settings → Secrets and variables → Actions → Secrets tab → New repository
secret** → name `VSCE_PAT`, value the token from step 1. Unlike the Client/Tenant IDs,
this genuinely is a secret — use the **Secrets** tab, not Variables.

### 3. Confirm the code is already wired for it

`.github/workflows/release.yml` should pass `VSCE_PAT: ${{ secrets.VSCE_PAT }}` in the
`env:` block of the `npx semantic-release` step, and
`extensions/simply-extension-pack/.releaserc.json`'s `publishCmd` should be
`npx vsce publish -p $VSCE_PAT --packagePath ...` — both already reflect this as of
2026-08-24.

### 4. Clear the stuck tag and retry

Because previous `--azure-credential` runs pushed a release commit and tag
(`simply-extension-pack-v1.0.0`) without actually publishing, semantic-release will think
that version already shipped. Clear it before retrying:

```bash
git tag -d simply-extension-pack-v1.0.0
git push origin :refs/tags/simply-extension-pack-v1.0.0
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
5. If it publishes under a different Marketplace publisher than `simply`, set up a
   separate managed identity (see "One-time Azure setup" above) and wire its
   client/tenant IDs into the workflow via `matrix.include` instead of the shared
   `vars.AZURE_CLIENT_ID`.
