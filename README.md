# Shared workflows

Reusable workflows for Practical Works repositories. A job that calls one runs in the caller, so its minutes and logs stay on the caller. Private source is not checked out into a run of this repository.

Consumers pin a tag:

```yaml
jobs:
  test:
    uses: PracticalWorks/.github/.github/workflows/test.yml@v1.1.0
```

## Tags

| Tag | Commit | What it adds |
| --- | --- | --- |
| `v1` | the first release | the five workflows and the setup action |
| `v1.1.0` | the merge of the v1.1.0 pull request | `pr-guard.yml` sets up Node and runs its own commit's script; failures are also `::error::` annotations; `coolify-deploy.yml` waits for Coolify's real outcome and can prove a version is live |

A release is a new tag on a commit of `main`. Existing tags are never moved or deleted, so a caller sees a change only when it bumps its pin. Do not pin `@main`.

`pr-guard.yml` and `coolify-deploy.yml` check out this repository's scripts at `job.workflow_sha`, the commit of the workflow file the caller invoked, so a caller pinned to `v1.1.0` runs `v1.1.0`'s scripts. If a runner leaves `job.workflow_sha` empty, they fall back to a tag written into the workflow file and say so with a warning. A release bumps that fallback to its own tag.

## Workflows

| File | Job |
| --- | --- |
| `setup.yml` | checkout, pnpm, Node, frozen install, then an optional `run` command |
| `test.yml` | the same setup, then lint, test, and an optional extra command |
| `image.yml` | build a GHCR image and push `:latest` and `:<sha>` |
| `coolify-deploy.yml` | read secrets from Infisical with GitHub OIDC, POST a Coolify webhook, then wait until the deploy is proven live |
| `pr-guard.yml` | require a `## Verification` heading and a `Refs:` line; optional secret-shape scan |

`test.yml` and `setup.yml` call `.github/actions/setup` themselves; `image.yml` installs nothing outside the Dockerfile. A following job cannot see the install from `setup.yml`.

## Caller permissions

A called workflow can only lower the token permissions its caller grants, never raise them, and Practical Works repositories default to a read-only token. A caller job that needs more grants it:

| Workflow | Caller job needs |
| --- | --- |
| `image.yml` | `permissions: { contents: read, packages: write }` |
| `coolify-deploy.yml` | `permissions: { contents: read, id-token: write }` |
| `setup.yml`, `test.yml`, `pr-guard.yml` | nothing beyond the read-only default |

Without it the workflow run fails before any step starts, because the nested job asks for a permission the caller never granted.

On macOS the setup action selects arm64 Node, so an Apple Silicon runner does not install an x64 build under Rosetta. Pass `node-architecture` to override it.

`runner` is a JSON array of labels, for example `'["ubuntu-latest"]'` or `'["self-hosted","mini"]'`.

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
| `token-secret-name` | `COOLIFY_API_TOKEN` | the token now also authorizes the status polls, so it is required. It needs deploy and read scope |

```yaml
jobs:
  deploy:
    permissions: { contents: read, id-token: write }
    uses: PracticalWorks/.github/.github/workflows/coolify-deploy.yml@v1.1.0
    with:
      infisical-identity-id: <identity id>
      infisical-project-slug: <project slug>
      health-url: https://app.example.com/health
      expected-version: ${{ github.sha }}
```

The webhook URL and the token are masked with `::add-mask::` before anything runs, and error messages name only the request path and status, never a response body.

## Pull request body

`pr-guard.yml` fails a pull request whose body lacks `## Verification`, or a line `Refs: KEY-123` with an uppercase key, unless the caller turns that check off. `scan-secrets: true` fails the job when an added diff line matches a high-confidence credential shape. The log names the pattern, not the line.

Every failure is printed to the log and also emitted as an `::error::` workflow command, so the reason shows as an annotation on the check even when a self-hosted runner loses the job log. The workflow sets up Node 22 itself, so it runs on self-hosted runners that ship without Node.
