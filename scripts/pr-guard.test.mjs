import assert from "node:assert/strict";
import { test } from "node:test";

import { missingBody, secretFindings } from "./pr-guard.mjs";

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
