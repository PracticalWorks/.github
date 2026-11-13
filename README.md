# Shared workflows

Reusable workflows for Practical Works repositories. A job that calls one runs in the caller, so its minutes and logs stay on the caller. Private source is not checked out into a run of this repository.

Consumers pin a tag:

```yaml
jobs:
  test:
    uses: PracticalWorks/.github/.github/workflows/test.yml@v1
```

`v1` is the floating major tag. Moving that tag in this repository is the one change that reaches every consumer pinned to it. Publish a commit here, then move `v1` to that commit. Do not pin `@main`.

## Workflows

| File | Job |
| --- | --- |
| `setup.yml` | checkout, pnpm, Node, frozen install, then an optional `run` command |
| `test.yml` | the same setup, then lint, test, and an optional extra command |
| `image.yml` | build a GHCR image and push `:latest` and `:<sha>` |
| `coolify-deploy.yml` | read secrets from Infisical with GitHub OIDC, then POST a Coolify webhook |
| `pr-guard.yml` | require a `## Verification` heading and a `Refs:` line; optional secret-shape scan |

`test.yml` and `image.yml` call `.github/actions/setup` themselves. `setup.yml` is the install-only job. A following job cannot see the install from `setup.yml`.

On macOS the setup action selects arm64 Node, so an Apple Silicon runner does not install an x64 build under Rosetta. Pass `node-architecture` to override it.

`runner` is a JSON array of labels, for example `'["ubuntu-latest"]'` or `'["self-hosted","mini"]'`.

## Secrets

`coolify-deploy.yml` authenticates to Infisical with OIDC (`method: oidc`). The caller passes `infisical-identity-id` and `infisical-project-slug`. Those are public. The identity has to exist in Infisical and trust this caller repository before the job can read secrets. Callers do not declare repository secrets for that job.

`image.yml` logs into GHCR with the job token. `npmrc: true` mounts that same token as a build secret for private package installs. It is not written into image history.

## Pull request body

`pr-guard.yml` fails a pull request whose body lacks `## Verification`, or a line `Refs: KEY-123` with an uppercase key, unless the caller turns that check off. `scan-secrets: true` fails the job when an added diff line matches a high-confidence credential shape. The log names the pattern, not the line.
