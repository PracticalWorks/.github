/**
 * Posts the Coolify deploy webhook, then proves the deploy instead of trusting
 * the trigger (FACT-1910).
 *
 * The webhook only says Coolify queued a deployment. A deploy that then fails
 * (a bad image, a healthcheck that never passes, so the rolling update keeps
 * the old container) would leave the job green while the old code serves. So
 * this polls GET /api/v1/deployments/<uuid> on the webhook's own origin until
 * Coolify reports `finished`, and fails on `failed` or `cancelled`. When the
 * caller names a health URL and an expected version, it then polls that URL
 * until the body contains the version. Modeled on PracticalWorks/frontdesk
 * scripts/ci/deploy-coolify.mjs (HOMEINFRA-498).
 *
 * The webhook URL and token are secrets: neither is ever printed, and error
 * bodies are never echoed because they can carry env values.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { reportFailure } from "./pr-guard.mjs";

const DONE_OK = "finished";
const DONE_BAD = ["failed", "cancelled", "cancelled-by-user"];
/** Polls in a row that may fail to reach Coolify before the job gives up. */
const MAX_POLL_MISSES = 6;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(method, url, status, bytes) {
    // Only the path is named: the webhook query string identifies the app.
    super(`${method} ${new URL(url).pathname} -> HTTP ${status} (body redacted, ${bytes} bytes)`);
    this.status = status;
  }
}

/** The Coolify API base is the webhook URL's origin. */
export function coolifyBase(webhookUrl) {
  return new URL(webhookUrl).origin;
}

export function deploymentUuid(parsed) {
  return String(parsed?.deployments?.[0]?.deployment_uuid ?? parsed?.deployment_uuid ?? "");
}

async function request(fetchImpl, method, url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetchImpl(url, { method, headers });
  const text = await res.text();
  if (!res.ok) throw new HttpError(method, url, res.status, text.length);
  return text;
}

export async function triggerDeploy({ webhookUrl, token, fetchImpl = fetch }) {
  const text = await request(fetchImpl, "POST", webhookUrl, token);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Coolify webhook answered with a body that is not JSON");
  }
  const id = deploymentUuid(parsed);
  if (!id) throw new Error("Coolify response missing deployment_uuid");
  return id;
}

/**
 * Polls the deployment until Coolify reports an end state. A 4xx is a real
 * answer (a bad token, an unknown deployment) and fails at once; an
 * unreachable Coolify (a network drop, a 5xx) is retried up to
 * MAX_POLL_MISSES times in a row.
 */
export async function waitForDeployment({
  base,
  token,
  uuid,
  deadline,
  fetchImpl = fetch,
  sleep = defaultSleep,
  now = Date.now,
  pollMs = 10_000,
  log = console.log,
}) {
  const url = `${base}/api/v1/deployments/${encodeURIComponent(uuid)}`;
  let last = "";
  let misses = 0;
  for (;;) {
    let status;
    try {
      status = String(JSON.parse(await request(fetchImpl, "GET", url, token)).status ?? "");
      misses = 0;
    } catch (err) {
      if ((err.status && err.status < 500) || ++misses > MAX_POLL_MISSES) throw err;
      log(`deployment ${uuid}: poll failed (${err.message}), retrying (${misses}/${MAX_POLL_MISSES})`);
      status = last;
    }
    if (status !== last) log(`deployment ${uuid}: ${status}`);
    last = status;
    if (status === DONE_OK) return;
    if (DONE_BAD.includes(status)) {
      throw new Error(
        `Coolify deployment ${uuid} ended ${status}: the previous version is still serving (see its Deployment Logs)`,
      );
    }
    if (now() + pollMs > deadline) {
      throw new Error(`Coolify deployment ${uuid} still ${last || "unknown"} at the timeout`);
    }
    await sleep(pollMs);
  }
}

/** Polls the health URL until its body contains the expected version. */
export async function waitForVersion({
  healthUrl,
  expectedVersion,
  deadline,
  fetchImpl = fetch,
  sleep = defaultSleep,
  now = Date.now,
  pollMs = 5_000,
  log = console.log,
}) {
  let last = "no answer yet";
  for (;;) {
    try {
      const body = await request(fetchImpl, "GET", healthUrl, "");
      if (body.includes(expectedVersion)) {
        log(`${new URL(healthUrl).pathname} serves ${expectedVersion}`);
        return;
      }
      last = `answered without ${expectedVersion} (${body.length} bytes)`;
    } catch (err) {
      last = err instanceof HttpError ? err.message : `unreachable (${err.message})`;
    }
    if (now() + pollMs > deadline) {
      throw new Error(`${new URL(healthUrl).pathname} never served ${expectedVersion}: last ${last}`);
    }
    await sleep(pollMs);
  }
}

export async function deployAndProve({
  webhookUrl,
  token,
  healthUrl = "",
  expectedVersion = "",
  wait = true,
  timeoutMs,
  setOutput = () => {},
  ...io
}) {
  if (!webhookUrl) throw new Error("no Coolify webhook URL");
  if (!token) throw new Error("no Coolify API token: the deploy cannot be proven without one");
  if (Boolean(healthUrl) !== Boolean(expectedVersion)) {
    throw new Error("health-url and expected-version go together: pass both or neither");
  }
  if (!wait && healthUrl) {
    throw new Error("health-url needs wait: a deploy that does not wait never polls it");
  }
  const now = io.now ?? Date.now;
  const deadline = now() + timeoutMs;
  const uuid = await triggerDeploy({ webhookUrl, token, fetchImpl: io.fetchImpl });
  setOutput(uuid);
  (io.log ?? console.log)(`Coolify deployment ${uuid} queued`);
  if (!wait) {
    // The caller pays per minute of runner; the wait is watched off the runner (FACT-2001).
    (io.log ?? console.log)(`not waiting: deployment ${uuid} is confirmed off the runner`);
    return uuid;
  }
  await waitForDeployment({ ...io, base: coolifyBase(webhookUrl), token, uuid, deadline });
  if (healthUrl) await waitForVersion({ ...io, healthUrl, expectedVersion, deadline });
  return uuid;
}

/** Leaves a minute of the job's timeout-minutes so the job fails here, by name. */
export function budgetMs(timeoutMinutes) {
  const minutes = Number(timeoutMinutes) || 10;
  return Math.max(60_000, (minutes - 1) * 60_000);
}

async function main() {
  const env = process.env;
  const webhookName = env.WEBHOOK_SECRET_NAME || "COOLIFY_WEBHOOK_URL";
  const tokenName = env.TOKEN_SECRET_NAME || "COOLIFY_API_TOKEN";
  const webhookUrl = env[webhookName] ?? "";
  const token = env[tokenName] ?? "";
  try {
    if (!webhookUrl) throw new Error(`Infisical did not export ${webhookName}`);
    if (!token) {
      throw new Error(`Infisical did not export ${tokenName}: the deploy cannot be proven without it`);
    }
    await deployAndProve({
      webhookUrl,
      token,
      healthUrl: env.HEALTH_URL ?? "",
      expectedVersion: env.EXPECTED_VERSION ?? "",
      wait: env.WAIT !== "false",
      timeoutMs: budgetMs(env.TIMEOUT_MINUTES),
      setOutput: (uuid) => {
        if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `deployment-uuid=${uuid}\n`);
      },
    });
  } catch (err) {
    reportFailure(err.message);
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) await main();
