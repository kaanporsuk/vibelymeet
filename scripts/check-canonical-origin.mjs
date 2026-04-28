#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Canonical app origin regression guard.
 *
 * Vibely's canonical web app origin is https://www.vibelymeet.com.
 * The apex origin may still redirect to www, and a few source-controlled
 * scripts/docs intentionally mention apex to prove or record that behavior.
 *
 * This guard fails when source-controlled text files reintroduce apex as a
 * canonical app-origin URL. Use https://www.vibelymeet.com for runtime
 * fallbacks, metadata, email/template links, notification links, and native
 * user-facing web links.
 */

const CANONICAL_ORIGIN = "https://www.vibelymeet.com";
const APEX_DOMAIN = "vibelymeet.com";
const DISALLOWED_ORIGINS = [`https://${APEX_DOMAIN}`, `http://${APEX_DOMAIN}`];

const EXCLUDED_PATH_PREFIXES = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  ".next/",
  ".turbo/",
  ".vercel/",
];

const BINARY_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".webm",
  ".woff",
  ".woff2",
]);

const ALLOWED_APEX_REFERENCES = [
  {
    path: "scripts/auth-redirect-contract.test.ts",
    reason: "Redirect contract test intentionally exercises the apex host.",
    allow: [/^const ORIGIN = "https:\/\/vibelymeet\.com";$/],
  },
  {
    path: "scripts/browser-auth-runtime-proof.mjs",
    reason: "Browser proof intentionally checks apex and canonical www origin compatibility.",
    allow: [/for \(const origin of \["https:\/\/vibelymeet\.com", "https:\/\/www\.vibelymeet\.com"\]\)/],
  },
  {
    path: "scripts/fresh-smoke-proof-bootstrap.mjs",
    reason: "Production smoke proof intentionally includes apex redirect coverage.",
    allow: [/^const ORIGINS = \["https:\/\/vibelymeet\.com", DEFAULT_ORIGIN\];$/],
  },
  {
    path: "scripts/fresh-vibe-upload-processing-proof.mjs",
    reason: "Production smoke proof intentionally includes apex redirect coverage.",
    allow: [/^const ORIGINS = \["https:\/\/vibelymeet\.com", DEFAULT_ORIGIN\];$/],
  },
  {
    path: "public/OneSignalSDK.sw.js",
    reason: "OneSignal worker-file comment is intentionally left untouched; worker behavior is out of scope for canonical cleanup.",
    allow: [/^\/\/ https:\/\/vibelymeet\.com\/OneSignalSDK\.sw\.js\?appId=\.\.\. can load without 404\.$/],
  },
  {
    path: "docs/web-push-production-checklist.md",
    reason: "Checklist explicitly verifies apex redirects to canonical www.",
    allow: [/Apex redirect: `https:\/\/vibelymeet\.com` redirects to `https:\/\/www\.vibelymeet\.com`/],
  },
  {
    path: "docs/authenticated-proof-and-rebuild-plan.md",
    reason: "Historical proof plan records apex redirect and earlier production proof evidence.",
    allow: [
      /Production apex redirect: `https:\/\/vibelymeet\.com` \u2192 `https:\/\/www\.vibelymeet\.com`/,
      /Live production `https:\/\/vibelymeet\.com\/invite\?ref=<uuid>` resolves/,
      /Live production fetch of `https:\/\/vibelymeet\.com\/OneSignalSDK\.sw\.js` returned/,
    ],
  },
  {
    path: "docs/browser-auth-runtime-proof-results.md",
    reason: "Historical browser proof result records the generated apex invite link at that time.",
    allow: [/Authenticated browser rendered `https:\/\/vibelymeet\.com\/invite\?ref=/],
  },
  {
    path: "docs/rebuild-rehearsal-log.md",
    reason: "Historical rebuild proof log records earlier apex production checks.",
    allow: [/`https:\/\/vibelymeet\.com\/(OneSignalSDK\.sw\.js|invite\?ref=<smoke-profile-uuid>|schedule|vibe-studio)`/, /`https:\/\/vibelymeet\.com\/(OneSignalSDK\.sw\.js|invite\?ref=<uuid>|schedule|vibe-studio)`/],
  },
  {
    path: "_cursor_context/rebuild_rehearsals/2026-03-11_current-controlled-baseline.md",
    reason: "Historical rebuild rehearsal note records an earlier apex authenticated smoke target.",
    allow: [/browser-based authenticated smoke on https:\/\/vibelymeet\.com/],
  },
];

function sourceControlledFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output
    .split("\0")
    .filter(Boolean)
    .filter((file) => !EXCLUDED_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .filter((file) => !BINARY_EXTENSIONS.has(path.extname(file).toLowerCase()));
}

function isBinary(buffer) {
  return buffer.includes(0);
}

function allowedReason(file, line) {
  for (const entry of ALLOWED_APEX_REFERENCES) {
    if (entry.path !== file) continue;
    if (entry.allow.some((pattern) => pattern.test(line))) {
      return entry.reason;
    }
  }
  return null;
}

const failures = [];
const allowed = [];
let scanned = 0;

for (const file of sourceControlledFiles()) {
  const buffer = readFileSync(file);
  if (isBinary(buffer)) continue;
  scanned += 1;

  const lines = buffer.toString("utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!DISALLOWED_ORIGINS.some((origin) => line.includes(origin))) return;
    const reason = allowedReason(file, line);
    const hit = {
      file,
      lineNumber: index + 1,
      snippet: line.trim(),
      reason,
    };
    if (reason) {
      allowed.push(hit);
    } else {
      failures.push(hit);
    }
  });
}

if (failures.length > 0) {
  console.error("Canonical origin guard failed.");
  console.error(`Canonical app origin: ${CANONICAL_ORIGIN}`);
  console.error("");
  for (const failure of failures) {
    console.error(`${failure.file}:${failure.lineNumber}: ${failure.snippet}`);
  }
  console.error("");
  console.error("Remediation: use https://www.vibelymeet.com for canonical app-origin links.");
  console.error("If an apex reference is intentional redirect coverage or historical proof, add a narrow exception with a reason in scripts/check-canonical-origin.mjs.");
  process.exit(1);
}

console.log(`Canonical origin guard passed. Scanned ${scanned} source-controlled text files.`);
console.log(`Canonical app origin: ${CANONICAL_ORIGIN}`);
console.log(`Allowed intentional apex references: ${allowed.length}`);
