import assert from "node:assert/strict";
import { test } from "node:test";

import {
  budgetMs,
  coolifyBase,
  deployAndProve,
  waitForDeployment,
  waitForVersion,
} from "./coolify-deploy.mjs";

const WEBHOOK = "https://cd.example.test/api/v1/deploy?uuid=app123&force=false";
const TOKEN = "test-token";

/** A fake clock that advances only when the code under test sleeps. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

function respond(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** Routes each call to the next scripted answer for its method and path. */
function fakeFetch(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const key = `${init.method} ${u.origin}${u.pathname}`;
    calls.push({ key, auth: init.headers.Authorization });
    const queue = script[key];
    if (!queue || queue.length === 0) throw new Error(`unscripted call ${key}`);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

const POST = "POST https://cd.example.test/api/v1/deploy";
const STATUS = "GET https://cd.example.test/api/v1/deployments/dep-1";
const HEALTH = "GET https://app.example.test/health";

test("the Coolify base is the webhook's origin", () => {
  assert.equal(coolifyBase(WEBHOOK), "https://cd.example.test");
});

test("waits through queued and in_progress to finished, with the bearer token", async () => {
  const { fetchImpl, calls } = fakeFetch({
    [POST]: [respond(200, { deployments: [{ deployment_uuid: "dep-1" }] })],
    [STATUS]: [
      respond(200, { status: "queued" }),
      respond(200, { status: "in_progress" }),
      respond(200, { status: "finished" }),
    ],
  });
  const outputs = [];
  const uuid = await deployAndProve({
    webhookUrl: WEBHOOK,
    token: TOKEN,
    timeoutMs: 600_000,
    setOutput: (id) => outputs.push(id),
    fetchImpl,
    ...clock(),
    log: () => {},
  });
  assert.equal(uuid, "dep-1");
  assert.deepEqual(outputs, ["dep-1"]);
  assert.equal(calls.filter((c) => c.key === STATUS).length, 3);
  assert.ok(calls.every((c) => c.auth === `Bearer ${TOKEN}`));
});

for (const end of ["failed", "cancelled", "cancelled-by-user"]) {
  test(`a deployment that ends ${end} fails by name`, async () => {
    const { fetchImpl } = fakeFetch({ [STATUS]: [respond(200, { status: end })] });
    await assert.rejects(
      waitForDeployment({
        base: "https://cd.example.test",
        token: TOKEN,
        uuid: "dep-1",
        deadline: 600_000,
        fetchImpl,
        ...clock(),
        log: () => {},
      }),
      new RegExp(`dep-1 ended ${end}`),
    );
  });
}

test("a 5xx poll is retried; a 4xx poll fails at once", async () => {
  const flaky = fakeFetch({
    [STATUS]: [respond(502, "bad gateway"), new TypeError("fetch failed"), respond(200, { status: "finished" })],
  });
  await waitForDeployment({
    base: "https://cd.example.test", token: TOKEN, uuid: "dep-1", deadline: 600_000,
    fetchImpl: flaky.fetchImpl, ...clock(), log: () => {},
  });
  const denied = fakeFetch({ [STATUS]: [respond(401, "SECRET-ish body")] });
  await assert.rejects(
    waitForDeployment({
      base: "https://cd.example.test", token: TOKEN, uuid: "dep-1", deadline: 600_000,
      fetchImpl: denied.fetchImpl, ...clock(), log: () => {},
    }),
    (err) => /HTTP 401 \(body redacted, 15 bytes\)/.test(err.message) && !err.message.includes("SECRET"),
  );
});

test("a deployment still running at the deadline fails", async () => {
  const { fetchImpl } = fakeFetch({ [STATUS]: [respond(200, { status: "in_progress" })] });
  await assert.rejects(
    waitForDeployment({
      base: "https://cd.example.test", token: TOKEN, uuid: "dep-1", deadline: 60_000,
      fetchImpl, ...clock(), log: () => {},
    }),
    /dep-1 still in_progress at the timeout/,
  );
});

test("then waits for the health URL to serve the expected version", async () => {
  const { fetchImpl, calls } = fakeFetch({
    [POST]: [respond(200, { deployment_uuid: "dep-1" })],
    [STATUS]: [respond(200, { status: "finished" })],
    [HEALTH]: [respond(503, "booting"), respond(200, '{"version":"old"}'), respond(200, '{"version":"abc123"}')],
  });
  await deployAndProve({
    webhookUrl: WEBHOOK, token: TOKEN, healthUrl: "https://app.example.test/health",
    expectedVersion: "abc123", timeoutMs: 600_000, fetchImpl, ...clock(), log: () => {},
  });
  assert.equal(calls.filter((c) => c.key === HEALTH).length, 3);
  assert.ok(calls.filter((c) => c.key === HEALTH).every((c) => c.auth === undefined));
});

test("a health URL that never serves the version fails, naming the last answer", async () => {
  const { fetchImpl } = fakeFetch({ [HEALTH]: [respond(200, '{"version":"old"}')] });
  await assert.rejects(
    waitForVersion({
      healthUrl: "https://app.example.test/health", expectedVersion: "abc123", deadline: 30_000,
      fetchImpl, ...clock(), log: () => {},
    }),
    /\/health never served abc123: last answered without abc123/,
  );
});

test("refuses to run without a token, or with only one of health-url and expected-version", async () => {
  await assert.rejects(deployAndProve({ webhookUrl: WEBHOOK, token: "", timeoutMs: 1 }), /no Coolify API token/);
  await assert.rejects(
    deployAndProve({ webhookUrl: WEBHOOK, token: TOKEN, healthUrl: "https://app.example.test/health", timeoutMs: 1 }),
    /go together/,
  );
});

test("a webhook answer without a deployment uuid fails", async () => {
  const { fetchImpl } = fakeFetch({ [POST]: [respond(200, { message: "ok" })] });
  await assert.rejects(
    deployAndProve({ webhookUrl: WEBHOOK, token: TOKEN, timeoutMs: 600_000, fetchImpl, ...clock(), log: () => {} }),
    /missing deployment_uuid/,
  );
});

test("a webhook error never echoes the query string or the body", async () => {
  const { fetchImpl } = fakeFetch({ [POST]: [respond(403, "token=abc")] });
  await assert.rejects(
    deployAndProve({ webhookUrl: WEBHOOK, token: TOKEN, timeoutMs: 600_000, fetchImpl, ...clock(), log: () => {} }),
    (err) => err.message === "POST /api/v1/deploy -> HTTP 403 (body redacted, 9 bytes)",
  );
});

test("the poll budget leaves a minute of the job timeout", () => {
  assert.equal(budgetMs(10), 9 * 60_000);
  assert.equal(budgetMs(1), 60_000);
  assert.equal(budgetMs(""), 9 * 60_000);
});

test("wait false posts the webhook, outputs the uuid and never polls (FACT-2001)", async () => {
  const { fetchImpl, calls } = fakeFetch({
    [POST]: [respond(200, { deployments: [{ deployment_uuid: "dep-1" }] })],
  });
  const outputs = [];
  const uuid = await deployAndProve({
    webhookUrl: WEBHOOK,
    token: TOKEN,
    wait: false,
    timeoutMs: 600_000,
    setOutput: (u) => outputs.push(u),
    fetchImpl,
    ...clock(),
    log: () => {},
  });
  assert.equal(uuid, "dep-1");
  assert.deepEqual(outputs, ["dep-1"]);
  assert.deepEqual(calls.map((c) => c.key), [POST]);
});

test("wait false refuses a health URL it would never poll", async () => {
  await assert.rejects(
    deployAndProve({
      webhookUrl: WEBHOOK,
      token: TOKEN,
      wait: false,
      healthUrl: "https://app.example.test/health",
      expectedVersion: "abc",
      timeoutMs: 1,
    }),
    /health-url needs wait/,
  );
});
