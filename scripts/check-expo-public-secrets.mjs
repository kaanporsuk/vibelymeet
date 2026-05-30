#!/usr/bin/env node
// Env-lint: fail if any EXPO_PUBLIC_* variable holds a secret-shaped value.
//
// EXPO_PUBLIC_* values are bundled into the native app and are therefore public. A value shaped
// like a server/secret key (e.g. RevenueCat `sk_…`, Stripe `sk_live_…`, webhook `whsec_…`) bundled
// under an EXPO_PUBLIC_ name is a leak. This guards against re-introduction (see audit F13).
//
// Read-only. Scans known .env locations; never prints secret values (only the key name + location).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const ENV_FILES = [
  "apps/mobile/.env",
  "apps/mobile/.env.local",
  "apps/mobile/.env.production",
  ".env",
  ".env.local",
];

// Secret-shaped prefixes that must never appear under an EXPO_PUBLIC_ key.
const SECRET_PREFIXES = [
  "sk_", // RevenueCat / Stripe secret key
  "sk_live_",
  "sk_test_",
  "rk_live_", // Stripe restricted key
  "whsec_", // Stripe/webhook signing secret
  "rcsk_", // RevenueCat secret
];

/** True if a key name is exempt from the secret-shape check (platform public keys are fine). */
function isAllowlistedExpoPublicKey(/* key */) {
  return false;
}

const violations = [];

for (const rel of ENV_FILES) {
  const abs = join(root, rel);
  if (!existsSync(abs)) continue;
  const lines = readFileSync(abs, "utf8").split(/\r?\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key.startsWith("EXPO_PUBLIC_")) return;
    if (isAllowlistedExpoPublicKey(key)) return;
    if (SECRET_PREFIXES.some((p) => value.toLowerCase().startsWith(p))) {
      // Report key name + location only; never the secret value.
      violations.push(`${rel}:${idx + 1} ${key} (value is secret-shaped)`);
    }
  });
}

if (violations.length > 0) {
  console.error("EXPO_PUBLIC secret-shape check FAILED — these public env vars look like secrets:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("\nEXPO_PUBLIC_* is bundled into the app. Rotate the key and use a non-public/server var, or platform-public keys only.");
  process.exit(1);
}

console.log("check-expo-public-secrets: no secret-shaped EXPO_PUBLIC_* values found");
