import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function exists(path: string): boolean {
  return existsSync(join(root, path));
}

function listFiles(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];

  return readdirSync(abs).flatMap((entry) => {
    const path = join(dir, entry);
    const fullPath = join(root, path);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (["node_modules", ".expo", ".next", "dist", "build", "coverage"].includes(entry)) return [];
      return listFiles(path);
    }
    return [path];
  });
}

const reportPath = "docs/investigations/payment-email-phone-trust-systems.md";
const branchDeltaPath = "docs/branch-deltas/fix-payment-email-phone-trust-systems-closure.md";
const report = read(reportPath);
const branchDelta = read(branchDeltaPath);

const stream9Artifacts = [
  "supabase/migrations/20260501220000_premium_credits_observability.sql",
  "supabase/validation/premium_credits_observability.sql",
  "supabase/functions/_shared/paymentObservability.ts",
  "supabase/functions/stripe-webhook/index.ts",
  "supabase/functions/create-checkout-session/index.ts",
  "supabase/functions/create-credits-checkout/index.ts",
  "supabase/functions/create-event-checkout/index.ts",
  "supabase/functions/create-portal-session/index.ts",
  "shared/matching/premiumCreditsObservability.test.ts",
  "docs/branch-deltas/fix-premium-credits-observability.md",
];

const stream14Artifacts = [
  "supabase/functions/email-verification/index.ts",
  "supabase/functions/event-notifications/index.ts",
  "supabase/functions/send-email/index.ts",
  "supabase/functions/send-support-reply/index.ts",
  "shared/matching/resendEmailProviderOperationalQa.test.ts",
  "docs/branch-deltas/fix-resend-email-provider-operational-qa.md",
  "docs/notification-system-design.md",
  "_cursor_context/vibely_external_dependency_ledger.md",
  "supabase/config.toml",
];

const stream15Artifacts = [
  "supabase/functions/phone-verify/index.ts",
  "src/components/PhoneVerification.tsx",
  "apps/mobile/components/verification/PhoneVerificationFlow.tsx",
  "src/lib/phoneVerificationState.ts",
  "apps/mobile/lib/profileApi.ts",
  "shared/matching/twilioPhoneVerificationQa.test.ts",
  "docs/branch-deltas/fix-twilio-phone-verification-qa.md",
  "_cursor_context/vibely_edge_function_manifest.md",
  "_cursor_context/vibely_external_dependency_ledger.md",
  "supabase/config.toml",
];

test("investigation report records PASS verdict and no repo repair stream", () => {
  assert.match(report, /## Executive Verdict\s+\nPASS\./);
  assert.match(report, /No Stripe idempotency defect/);
  assert.match(report, /No repair stream is recommended for this investigation batch/);
  assert.match(report, /NOT READY markers: none/);
  assert.match(report, /No real payment\./);
  assert.match(report, /No real email\./);
  assert.match(report, /No real SMS\./);
  assert.match(report, /No Supabase cloud mutation\./);
  assert.match(report, /No deploy\./);
});

test("closure branch delta documents Mode C docs-test-only scope and no deploy", () => {
  assert.match(branchDelta, new RegExp(reportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(branchDelta, /Mode C - docs\/test-only closure/);
  assert.match(branchDelta, /Supabase migration requirement:\s*not required/i);
  assert.match(branchDelta, /Edge Function deploy requirement:\s*not required/i);
  assert.match(branchDelta, /web\/static deploy requirement:\s*not required/i);
  assert.match(branchDelta, /env vars added\/changed:\s*none/i);
  assert.match(branchDelta, /native module changes:\s*none/i);
  assert.match(branchDelta, /`expo-av`:\s*not used/i);
  assert.match(branchDelta, /production data-mutating smoke:\s*not run/i);
  assert.match(branchDelta, /real payment\/email\/SMS smoke:\s*not run/i);
});

test("Stream 9, 14, and 15 artifacts remain present", () => {
  for (const path of [...stream9Artifacts, ...stream14Artifacts, ...stream15Artifacts]) {
    assert.equal(exists(path), true, `${path} should exist`);
  }

  assert.match(read("shared/matching/premiumCreditsObservability.test.ts"), /Stripe event id/);
  assert.match(read("shared/matching/resendEmailProviderOperationalQa.test.ts"), /RESEND_API_KEY/);
  assert.match(read("shared/matching/twilioPhoneVerificationQa.test.ts"), /TWILIO_VERIFY_SERVICE_SID/);
});

test("manual provider follow-ups stay explicit and out of repo automation", () => {
  for (const provider of ["Stripe", "Resend", "Twilio"]) {
    assert.match(report, new RegExp(`${provider}: confirm`, "i"));
    assert.match(branchDelta, new RegExp(`${provider}`, "i"));
  }

  assert.match(branchDelta, /controlled payment\/webhook replay QA only after explicit approval/i);
  assert.match(branchDelta, /controlled internal email QA with owned recipients only/i);
  assert.match(branchDelta, /controlled internal SMS QA with owned numbers only/i);
});

test("closure adds no Supabase migration, validation SQL, Edge Function, or config artifact", () => {
  const suspiciousSupabaseArtifacts = [
    ...listFiles("supabase/migrations"),
    ...listFiles("supabase/validation"),
    ...listFiles("supabase/functions"),
  ].filter((path) => /payment[-_]?email[-_]?phone[-_]?trust[-_]?systems[-_]?closure/i.test(path));

  assert.deepEqual(suspiciousSupabaseArtifacts, [], "docs/test-only closure must not add Supabase artifacts");
  assert.match(branchDelta, /Edge Functions changed\/deployed:\s*not required/i);
  assert.match(branchDelta, /schema\/storage changes:\s*none/i);
});

test("closure introduces no env vars, native modules, or expo-av usage", () => {
  for (const path of ["package.json", "apps/mobile/package.json"]) {
    assert.doesNotMatch(read(path), /"expo-av"\s*:/, `${path} must not add expo-av`);
    assert.doesNotMatch(read(path), /"@twilio|twilio|resend"\s*:/i, `${path} must not add provider SDK modules`);
  }

  for (const path of [
    ...listFiles("src"),
    ...listFiles("apps/mobile"),
    ...listFiles("shared"),
    ...listFiles("supabase/functions"),
  ]) {
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) continue;
    assert.doesNotMatch(
      read(path),
      /(?:from|require\(|import\()\s*['"]expo-av['"]/,
      `${path} must not import expo-av`,
    );
  }

  assert.doesNotMatch(branchDelta, /new env var|added env var|service role key/i);
});
