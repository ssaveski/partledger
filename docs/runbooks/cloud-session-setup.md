# Cloud-session setup

How to prepare a Claude Code cloud session (or a fresh laptop) so that `pnpm install --frozen-lockfile` and `pnpm verify` run exactly as in CI.

## Setup script

Paste this into the cloud environment's setup script. It is idempotent.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Node 24 LTS (plan KTD8). Cloud images ship `n`; on a laptop use nvm with .nvmrc.
n install 24
hash -r
node --version

# pnpm comes from the `packageManager` field through corepack.
corepack enable
pnpm --version

# Docker for the Testcontainers integration tests.
if ! docker info > /dev/null 2>&1; then
  (dockerd > /tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info > /dev/null 2>&1 && break; sleep 1; done
fi
docker pull postgres:18
# Keycloak for the staff sign-in tests (docs/runbooks/keycloak.md).
docker pull quay.io/keycloak/keycloak:26.4
```

If the image already has Node 24 installed but not first on `PATH`, prefix commands with `PATH=/usr/local/n/versions/node/24.<minor>.<patch>/bin:$PATH`.

## Playwright browsers

`@playwright/test` is pinned to the version whose Chromium build is preinstalled in cloud images (`/opt/pw-browsers`, `PLAYWRIGHT_BROWSERS_PATH`). Do not run `playwright install` in a cloud session. CI installs the matching browser with `pnpm exec playwright install --with-deps chromium`. Upgrading Playwright means checking that the cloud image carries the new Chromium build first.

## Network allowlist

The environment's network policy must allow:

| Host | Why |
|---|---|
| `registry.npmjs.org` | dependencies, and the supply-chain policy tests that probe the registry |
| `github.com`, `api.github.com`, `codeload.github.com` | clone, push, resolving action digests |
| `registry-1.docker.io`, `auth.docker.io`, `production.cloudflare.docker.com` | the `postgres:18` image and later service images |
| `quay.io`, `cdn01.quay.io` | the `quay.io/keycloak/keycloak:26.4` image |
| `cdn.playwright.dev`, `playwright.download.prss.microsoft.com` | only if a laptop or CI installs Playwright browsers |

## Checks

```bash
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm install` fails when a dependency wants to run an install script that is not listed in `allowBuilds` in `pnpm-workspace.yaml`, or when a version is younger than `minimumReleaseAge`. Add a package to `allowBuilds` only after reading its script; `false` means the package works without it.
