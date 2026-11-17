import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REF = "[A-Z][A-Z0-9]{1,11}-\\d{1,6}";
const REFS_LINE = new RegExp(`^[ \\t]*Refs?[ \\t]*:[ \\t]*${REF}`, "m");
const VERIFICATION = /^##[ \t]+Verification\b/m;

const SECRET_RULES = [
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github-pat", re: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { name: "github-fine-grained", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
];

/**
 * Escapes a message for a GitHub workflow command, as GitHub's toolkit does:
 * % first, then CR and LF, so a multi-line message stays one annotation.
 */
export function escapeCommandData(message) {
  return String(message)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

export function errorCommand(message) {
  return `::error::${escapeCommandData(message)}`;
}

/**
 * Prints a failure to stderr for the job log, and again as an `::error::`
 * command so it also lands as a check annotation. The annotation survives
 * when a self-hosted runner loses the job log (FACT-1971).
 */
export function reportFailure(message, write = { err: console.error, out: console.log }) {
  write.err(message);
  write.out(errorCommand(message));
}

export function missingBody(body, options) {
  const text = String(body ?? "");
  const missing = [];
  if (options.verification && !VERIFICATION.test(text)) {
    missing.push("a ## Verification section");
  }
  if (options.refs && !REFS_LINE.test(text)) {
    missing.push("a Refs: KEY-123 line");
  }
  return missing;
}

export function secretFindings(diff) {
  const found = new Set();
  for (const line of String(diff).split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const rule of SECRET_RULES) {
      if (rule.re.test(line)) found.add(rule.name);
    }
  }
  return [...found];
}

function flag(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

function scanSecrets() {
  const base = process.env.BASE_SHA ?? "";
  const head = process.env.HEAD_SHA ?? "";
  if (!base || !head) {
    reportFailure("guardrails: secret scan needs BASE_SHA and HEAD_SHA");
    return false;
  }
  const diff = execFileSync("git", ["diff", "--unified=0", base, head], {
    encoding: "utf8",
  });
  const hits = secretFindings(diff);
  if (hits.length > 0) {
    reportFailure(`guardrails: secret-shaped text in the diff (${hits.join(", ")})`);
    return false;
  }
  return true;
}

function main() {
  const missing = missingBody(process.env.PR_BODY ?? "", {
    verification: flag("REQUIRE_VERIFICATION", true),
    refs: flag("REQUIRE_REFS", true),
  });
  if (missing.length > 0) {
    reportFailure(`pr body: missing ${missing.join(" and ")}`);
    process.exitCode = 1;
    return;
  }
  if (flag("SCAN_SECRETS", false) && !scanSecrets()) {
    process.exitCode = 1;
    return;
  }
  console.log("pr body ok");
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) main();
