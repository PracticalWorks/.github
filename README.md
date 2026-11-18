# Shared workflows

**Reusable GitHub Actions workflows for pnpm repositories: test, build a GHCR image, deploy to Coolify and wait until it is live, and guard a pull request body.** Call one with a single `uses:` line and pin a tag; a fix reaches every caller through a pin bump instead of one copied YAML file per repository.

[![ci](https://github.com/PracticalWorks/.github/actions/workflows/ci.yml/badge.svg)](https://github.com/PracticalWorks/.github/actions/workflows/ci.yml)
[![MIT licence](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

This repository also holds the Practical Works organization profile (`profile/README.md`). The workflows are what you can reuse. A job that calls one runs in the caller, so its minutes and logs stay on the caller. Private source is not checked out into a run of this repository.

## Quick start

In a pnpm repository with `lint` and `test` scripts, add `.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]

jobs:
  test:
    uses: PracticalWorks/.github/.github/workflows/test.yml@v1.4.0
```

That checks out the repository, installs pnpm and Node 22, runs `pnpm install --frozen-lockfile`, then `pnpm lint` and `pnpm test`. Override any of them with `with:` (for example `test: pnpm vitest run`, or `runner: '["self-hosted"]'`). The sections below cover the other workflows and their inputs.

Always pin a tag, never `@main`. The tags so far:

## Tags

| Tag | Commit | What it adds |
| --- | --- | --- |
| `v1` | the first release | the five workflows and the setup action |
| `v1.1.0` | the merge of the v1.1.0 pull request | `pr-guard.yml` sets up Node and runs its own commit's script; failures are also `::error::` annotations; `coolify-deploy.yml` waits for Coolify's real outcome and can prove a version is live |
| `v1.2.0` | the merge of the v1.2.0 pull request | `coolify-deploy.yml` takes `environment` (and `deployment`), so an Infisical identity can trust one GitHub environment of the caller; the setup action takes `cache` |
| `v1.3.0` | the merge of the v1.3.0 pull request | `coolify-deploy.yml` takes `wait` (false: post the webhook and exit, so the caller is billed seconds, not the wait) and `pre-deploy-run` (a shell step in the caller's checkout before the webhook, e.g. an env sync, instead of a separate job) |
| `v1.4.0` | the merge of the v1.4.0 pull request | `image.yml` takes `build-args`, so a Dockerfile can receive the commit sha it was built from |

A release is a new tag on a commit of `main`. Existing tags are never moved or deleted, so a caller sees a change only when it bumps its pin. Do not pin `@main`.

`pr-guard.yml` and `coolify-deploy.yml` check out this repository's scripts at `job.workflow_sha`, the commit of the workflow file the caller invoked, so a caller pinned to `v1.3.0` runs `v1.3.0`'s scripts. If a runner leaves `job.workflow_sha` empty, they fall back to a tag written into the workflow file and say so with a warning. A release bumps that fallback to its own tag.

## Workflows

| File | Job |
| --- | --- |
| `setup.yml` | checkout, pnpm, Node, frozen install, then an optional `run` command |
| `test.yml` | the same setup, then lint, test, and an optional extra command |
| `image.yml` | build a GHCR image and push `:latest` and `:<sha>` |
| `coolify-deploy.yml` | read secrets from Infisical with GitHub OIDC, POST a Coolify webhook, then wait until the deploy is proven live |
| `pr-guard.yml` | require a `## Verification` heading and a `Refs:` line; optional secret-shape scan |

`image.yml` passes `build-args` (one `KEY=value` per line) to the build. A Dockerfile that declares `ARG BUILD_SHA` and `ENV BUILD_SHA=$BUILD_SHA` then knows its own commit at runtime, for example to serve it on a version endpoint:

```yaml
jobs:
  build:
    permissions: { contents: read, packages: write }
    uses: PracticalWorks/.github/.github/workflows/image.yml@v1.4.0
    with:
      image: ghcr.io/<org>/<app>
      build-args: |
        BUILD_SHA=${{ github.sha }}
```

Build-args are recorded in the image history, so pass a credential with `npmrc` (a build secret), never as a build-arg.

`test.yml` and `setup.yml` call `.github/actions/setup` themselves; `image.yml` installs nothing outside the Dockerfile. A following job cannot see the install from `setup.yml`.

## Caller permissions

A called workflow can only lower the token permissions its caller grants, never raise them, and Practical Works repositories default to a read-only token. A caller job that needs more grants it:

| Workflow | Caller job needs |
| --- | --- |
| `image.yml` | `permissions: { contents: read, packages: write }` |
| `coolify-deploy.yml` | `permissions: { contents: read, id-token: write }` |
| `setup.yml`, `test.yml`, `pr-guard.yml` | nothing beyond the read-only default |

Without it the workflow run fails before any step starts, because the nested job asks for a permission the caller never granted.

The setup action caches the pnpm store through `actions/setup-node` unless the caller passes `cache: false`, for example on runners that keep the store between jobs.

On macOS the setup action selects arm64 Node, so an Apple Silicon runner does not install an x64 build under Rosetta. Pass `node-architecture` to override it.

`runner` is a JSON array of labels, for example `'["ubuntu-latest"]'` or `'["self-hosted","linux"]'`.

## Secrets

`coolify-deploy.yml` authenticates to Infisical with OIDC (`method: oidc`). The caller passes `infisical-identity-id` and `infisical-project-slug`. Those are public. The identity has to exist in Infisical and trust this caller repository before the job can read secrets. Callers do not declare repository secrets for that job.

`image.yml` logs into GHCR with the job token. `npmrc: true` mounts that same token as a build secret for private package installs. It is not written into image history.

## Coolify deploy

The job goes green only when the deploy is live, not when Coolify accepts the webhook:

1. It posts the webhook with the bearer token and reads the deployment uuid from the answer (the `deployment-uuid` output).
2. It polls `GET /api/v1/deployments/<uuid>` on the webhook URL's origin with the same token every 10 seconds, until Coolify reports `finished`. `failed`, `cancelled` or `cancelled-by-user` fails the job. A 4xx fails at once; an unreachable Coolify (a network drop, a 5xx) is retried six times in a row.
3. If the caller passes `health-url` and `expected-version`, it polls `health-url` every 5 seconds until the body contains `expected-version`, for example the git sha the image was built from.

| Input | Default | Meaning |
| --- | --- | --- |
| `health-url` | empty | URL to poll after Coolify reports `finished`. Pass it with `expected-version`, or leave both empty |
| `expected-version` | empty | text `health-url` must serve, e.g. `${{ github.sha }}` |
| `timeout-minutes` | `10` | job timeout. All three phases share it, less one minute, so a slow deploy fails with an `::error::` naming the phase instead of being killed |
| `oidc-audience` | empty | `aud` of the GitHub OIDC token. Pass the audience the identity binds; the Infisical action's default is not ours |
| `environment` | empty | GitHub environment the deploy job runs in. See below |
| `deployment` | `true` | with `environment`, whether GitHub records a Deployment for the job. `false` for a caller that writes its own records |
| `wait` | `true` | `false` posts the webhook, outputs `deployment-uuid` and exits. Something off the runner must then watch the deployment; `health-url` is refused with it |
| `pre-deploy-run` | empty | shell run in a checkout of the caller's commit, after the Infisical secrets are exported and Node 22 is set up, before the webhook |
| `token-secret-name` | `COOLIFY_API_TOKEN` | the token now also authorizes the status polls, so it is required. It needs deploy and read scope |

```yaml
jobs:
  deploy:
    permissions: { contents: read, id-token: write }
    uses: PracticalWorks/.github/.github/workflows/coolify-deploy.yml@v1.3.0
    with:
      infisical-identity-id: <identity id>
      infisical-project-slug: <project slug>
      oidc-audience: https://github.com/<org>
      environment: app-prod
      webhook-secret-name: COOLIFY_APP_WEBHOOK_URL
      health-url: https://app.example.com/health
      expected-version: ${{ github.sha }}
```

### Environment

An Infisical OIDC identity trusts a subject such as `repo:<org>/<repo>:environment:app-prod`. The token carries `environment:<name>` only when the job that requests it runs in that environment, and a caller job that `uses:` a workflow cannot set `environment:`. So the deploy job sets `environment.name: ${{ inputs.environment }}` itself; GitHub still builds `sub` from the caller repository. The environment's protection rules and secrets apply to the deploy job, and an environment that does not exist yet is created on the caller's first run. Leave it empty for an identity that trusts a branch or ref instead.

A job in an environment also gets a GitHub Deployment record for the caller's commit. A caller that writes its own Deployment records in that environment passes `deployment: false`, so the job's record is not read as one of them. Custom deployment protection rules cannot be combined with `deployment: false`.

The webhook URL and the token are masked with `::add-mask::` before anything runs, and error messages name only the request path and status, never a response body.

## Pull request body

`pr-guard.yml` fails a pull request whose body lacks `## Verification`, or a line `Refs: KEY-123` with an uppercase key, unless the caller turns that check off. `scan-secrets: true` fails the job when an added diff line matches a high-confidence credential shape. The log names the pattern, not the line.

Every failure is printed to the log and also emitted as an `::error::` workflow command, so the reason shows as an annotation on the check even when a self-hosted runner loses the job log. The workflow sets up Node 22 itself, so it runs on self-hosted runners that ship without Node.

## Used by

Our public packages build and release with these workflows: [PracticalWorks/crm](https://github.com/PracticalWorks/crm), [PracticalWorks/guardrails](https://github.com/PracticalWorks/guardrails) and [PracticalWorks/rc-bridge](https://github.com/PracticalWorks/rc-bridge).

## License

MIT, see [LICENSE](LICENSE). Made by [Practical Works](https://practical.works), a small software shop in Tampa Bay; questions and bug reports are welcome in [issues](https://github.com/PracticalWorks/.github/issues).
