import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  escapeCommandData,
  missingBody,
  reportFailure,
  secretFindings,
} from "./pr-guard.mjs";

const okBody = "## Verification\n\nChecked the shape.\n\nRefs: ABCD-12\n";

test("accepts a verification heading and an uppercase refs line", () => {
  assert.deepEqual(missingBody(okBody, { verification: true, refs: true }), []);
});

test("names each missing piece", () => {
  assert.deepEqual(missingBody("no contract here", { verification: true, refs: true }), [
    "a ## Verification section",
    "a Refs: KEY-123 line",
  ]);
});

test("refuses a lower-case ref", () => {
  const missing = missingBody("## Verification\n\nRefs: abcd-12\n", {
    verification: true,
    refs: true,
  });
  assert.deepEqual(missing, ["a Refs: KEY-123 line"]);
});

test("skips a check the caller turned off", () => {
  assert.deepEqual(missingBody("Refs: ABCD-1\n", { verification: false, refs: true }), []);
});

test("secret scan reports the pattern and ignores context lines", () => {
  const diff = [
    "+++ b/config.js",
    "+const key = \"AKIAIOSFODNN7EXAMPLE\"",
    " ghp_aaaaaaaaaaaaaaaaaaaa",
  ].join("\n");
  assert.deepEqual(secretFindings(diff), ["aws-access-key"]);
});

test("secret scan sees a private key banner on an added line", () => {
  assert.deepEqual(
    secretFindings("+-----BEGIN OPENSSH PRIVATE KEY-----\n"),
    ["private-key"],
  );
});

test("escapes %, CR and LF so a message is one workflow command", () => {
  assert.equal(escapeCommandData("100% done\r\nnext\nline"), "100%25 done%0D%0Anext%0Aline");
  assert.equal(escapeCommandData("%0A"), "%250A");
});

test("a failure goes to stderr and out again as an ::error:: annotation", () => {
  const err = [];
  const out = [];
  reportFailure("pr body: missing a Refs: KEY-123 line\nsecond", {
    err: (m) => err.push(m),
    out: (m) => out.push(m),
  });
  assert.deepEqual(err, ["pr body: missing a Refs: KEY-123 line\nsecond"]);
  assert.deepEqual(out, ["::error::pr body: missing a Refs: KEY-123 line%0Asecond"]);
});

test("the CLI prints the missing body pieces as an ::error:: command", () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("./pr-guard.mjs", import.meta.url))], {
    env: { ...process.env, PR_BODY: "no contract", REQUIRE_VERIFICATION: "true", REQUIRE_REFS: "true", SCAN_SECRETS: "false" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^pr body: missing a ## Verification section and a Refs: KEY-123 line$/m);
  assert.match(run.stdout, /^::error::pr body: missing a ## Verification section and a Refs: KEY-123 line$/m);
});

test("the CLI emits no ::error:: for a good body", () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("./pr-guard.mjs", import.meta.url))], {
    env: { ...process.env, PR_BODY: okBody, SCAN_SECRETS: "false" },
    encoding: "utf8",
  });
  assert.equal(run.status, 0);
  assert.doesNotMatch(run.stdout, /::error::/);
});
