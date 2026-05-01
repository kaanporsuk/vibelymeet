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

function readTreeFiles(
  dir: string,
  extensions: ReadonlySet<string>,
  ignored = new Set(["node_modules", ".expo", ".next", "dist", "build"]),
): string[] {
  const abs = join(root, dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    if (ignored.has(entry)) continue;
    const absPath = join(abs, entry);
    const relPath = `${dir}/${entry}`;
    const st = statSync(absPath);
    if (st.isDirectory()) {
      out.push(...readTreeFiles(relPath, extensions, ignored));
    } else if (extensions.has(entry.slice(entry.lastIndexOf(".")))) {
      out.push(relPath);
    }
  }
  return out;
}

function assertOrder(source: string, labels: Array<[string, string]>): void {
  let last = -1;
  for (const [label, needle] of labels) {
    const index = source.indexOf(needle, last + 1);
    assert.ok(index >= 0, `${label} marker should exist`);
    assert.ok(index > last, `${label} should appear after the previous marker`);
    last = index;
  }
}

function envNames(source: string): string[] {
  return Array.from(
    new Set(
      [...source.matchAll(/Deno\.env\.get\(["']([A-Z0-9_]+)["']\)/g)].map((match) => match[1]),
    ),
  ).sort();
}

function consoleLines(source: string): string[] {
  return source.split("\n").filter((line) => /console\.(?:log|warn|error)/.test(line));
}

const phoneVerify = read("supabase/functions/phone-verify/index.ts");
const webPhoneVerification = read("src/components/PhoneVerification.tsx");
const nativePhoneVerification = read("apps/mobile/components/verification/PhoneVerificationFlow.tsx");
const phoneVerificationState = read("src/lib/phoneVerificationState.ts");
const nativeProfileApi = read("apps/mobile/lib/profileApi.ts");
const supabaseConfig = read("supabase/config.toml");
const edgeManifest = read("_cursor_context/vibely_edge_function_manifest.md");
const providerLedger = read("_cursor_context/vibely_external_dependency_ledger.md");
const branchDelta = read("docs/branch-deltas/fix-twilio-phone-verification-qa.md");
const rootPackageJson = read("package.json");
const nativePackageJson = read("apps/mobile/package.json");

test("phone-verify is config-listed with verify_jwt true", () => {
  assert.match(supabaseConfig, /\[functions\.phone-verify\][\s\S]{0,80}verify_jwt = true/);
  assert.match(edgeManifest, /`phone-verify`[\s\S]{0,260}verify_jwt = true/);
  assert.match(branchDelta, /Gateway JWT posture: `verify_jwt = true`/);
});

test("phone-verify reads the expected Twilio secret names only", () => {
  assert.match(phoneVerify, /Deno\.env\.get\("TWILIO_ACCOUNT_SID"\)/);
  assert.match(phoneVerify, /Deno\.env\.get\("TWILIO_AUTH_TOKEN"\)/);
  assert.match(phoneVerify, /Deno\.env\.get\("TWILIO_VERIFY_SERVICE_SID"\)/);
  assert.deepEqual(envNames(phoneVerify), [
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_VERIFY_SERVICE_SID",
  ]);
  assert.match(providerLedger, /`TWILIO_ACCOUNT_SID`/);
  assert.match(providerLedger, /`TWILIO_AUTH_TOKEN`/);
  assert.match(providerLedger, /`TWILIO_VERIFY_SERVICE_SID`/);
});

test("phone-verify requires authenticated user context before diagnostics or provider calls", () => {
  assertOrder(phoneVerify, [
    ["auth header read", "const authHeader = req.headers.get(\"authorization\")"],
    ["auth user resolution", "supabase.auth.getUser()"],
    ["health check after auth", "if (action === \"health_check\")"],
    ["provider auth material after auth", "const twilioAuth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)"],
  ]);
  assert.match(phoneVerify, /if \(!authHeader\)[\s\S]{0,140}Not authenticated/);
  assert.match(phoneVerify, /if \(authError \|\| !user\)[\s\S]{0,180}Authentication failed/);
});

test("send and check actions remain product-compatible", () => {
  assert.match(phoneVerify, /if \(action === "send_otp"\)/);
  assert.match(phoneVerify, /if \(action === "verify_otp"\)/);
  assert.match(webPhoneVerification, /action:\s*"send_otp"/);
  assert.match(webPhoneVerification, /action:\s*"verify_otp"/);
  assert.match(nativePhoneVerification, /action:\s*'send_otp'/);
  assert.match(nativePhoneVerification, /action:\s*'verify_otp'/);
  assert.match(phoneVerify, /Always return HTTP 200/);
  assert.match(phoneVerify, /return jsonResponse\(\{ success: false, error: "Invalid action\." \}\)/);
});

test("rate limiting and attempt tracking remain present", () => {
  assert.match(phoneVerify, /Rate limiting: max 5 SMS per hour per user/);
  assert.match(phoneVerify, /const oneHourAgo = new Date\(Date\.now\(\) - 60 \* 60 \* 1000\)\.toISOString\(\)/);
  assert.match(phoneVerify, /\.from\("verification_attempts"\)[\s\S]{0,220}\.gte\("attempt_at", oneHourAgo\)/);
  assert.match(phoneVerify, /attemptCount !== null && attemptCount >= 5/);
  assert.match(phoneVerify, /errorType:\s*"rate_limited"/);
  assert.match(phoneVerify, /\.from\("verification_attempts"\)\.insert\(\{/);
});

test("Lookup line-type guard remains present and fail-open posture is documented", () => {
  assert.match(phoneVerify, /https:\/\/lookups\.twilio\.com\/v2\/PhoneNumbers/);
  assert.match(phoneVerify, /Fields=line_type_intelligence/);
  assert.match(phoneVerify, /lineType && lineType !== "mobile" && lineType !== "cellphone"/);
  assert.match(phoneVerify, /errorType:\s*"invalid_number_type"/);
  assert.match(phoneVerify, /lookup_failed_continue/);
  assert.match(branchDelta, /Lookup failures remain fail-open/);
});

test("one-user-one-phone association guard remains present", () => {
  for (const marker of ["This number is already verified by another account.", "This phone number is already associated with another account."]) {
    assert.match(phoneVerify, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(phoneVerify, /\.from\("profiles"\)[\s\S]{0,160}\.eq\("phone_number", phoneNumber\)[\s\S]{0,120}\.eq\("phone_verified", true\)[\s\S]{0,120}\.neq\("id", user\.id\)/);
  assert.match(phoneVerify, /errorType:\s*"phone_already_claimed"/);
  assert.match(phoneVerify, /phone_verified_at:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(phoneVerificationState, /profiles\.phone_verified` is the verified truth/);
  assert.match(nativeProfileApi, /phone_number, phone_verified/);
});

test("WebOTP-friendly entry remains present where implemented", () => {
  assert.match(webPhoneVerification, /autoComplete=\{i === 0 \? "one-time-code" : "off"\}/);
  assert.match(webPhoneVerification, /inputMode="numeric"/);
  assert.match(webPhoneVerification, /handleOtpPaste/);
  assert.match(branchDelta, /WebOTP Posture/);
});

test("phone verification logs exclude OTPs, phone numbers, and secret values", () => {
  assert.match(phoneVerify, /maskPhoneForLog/);
  assert.match(phoneVerify, /requestId = crypto\.randomUUID\(\)/);
  assert.doesNotMatch(phoneVerify, /TWILIO_[A-Z_]+\.slice|TWILIO_TOKEN\.length|url\.slice\(0/);
  assert.doesNotMatch(webPhoneVerification, /Sending OTP to:|Send OTP response:|Verify OTP response:|OTP sent successfully/);

  const activeSources = [phoneVerify, webPhoneVerification, nativePhoneVerification].join("\n");
  for (const line of consoleLines(activeSources)) {
    assert.doesNotMatch(
      line,
      /TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_VERIFY_SERVICE_SID|\$\{TWILIO_|twilioAuth|Authorization/i,
      `console line must not print Twilio secret material: ${line}`,
    );
    assert.doesNotMatch(
      line,
      /fullPhoneNumber|phoneNumber|otpCode|Code:\s*code|data\?\.message|url:/,
      `console line must not print phone numbers, OTPs, or provider URLs: ${line}`,
    );
  }
});

test("no env vars, migrations, native modules, expo-av, or unrelated provider changes were added", () => {
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => name.includes("twilio_phone_verification_qa")),
    false,
    "Stream 15 should not add a Supabase migration",
  );
  assert.doesNotMatch(rootPackageJson, /"@twilio|twilio"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"@twilio|twilio|expo-av"\s*:/);

  const nativeFiles = readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]));
  for (const path of nativeFiles) {
    assert.doesNotMatch(
      read(path),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }

  assert.match(branchDelta, /No new env vars were added/);
  assert.match(branchDelta, /No Supabase migration was added/);
  assert.match(branchDelta, /No native modules were added/);
  assert.match(branchDelta, /No `expo-av` import or package was added/);
});

test("Streams 1-14 artifacts remain present", () => {
  for (const path of [
    "shared/matching/eventLobbyActiveEventContract.test.ts",
    "shared/matching/readyGateTransitionExpiryRowcount.test.ts",
    "shared/matching/readyGateEventEndedTerminalization.test.ts",
    "shared/matching/readyGateContractConsumerCompliance.test.ts",
    "shared/matching/readyGateTerminalUxObservability.test.ts",
    "shared/matching/nativeReadyGateParityContract.test.ts",
    "shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts",
    "shared/matching/realtimeSubscriptionTightening.test.ts",
    "shared/matching/premiumCreditsObservability.test.ts",
    "shared/matching/nativeVideoDateContractRecovery.test.ts",
    "shared/matching/onesignalProviderOperationalQa.test.ts",
    "shared/matching/bunnyProviderOperationalQa.test.ts",
    "shared/matching/dailyProviderOperationalQa.test.ts",
    "shared/matching/resendEmailProviderOperationalQa.test.ts",
    "docs/branch-deltas/fix-onesignal-provider-operational-qa.md",
    "docs/branch-deltas/fix-bunny-provider-operational-qa.md",
    "docs/branch-deltas/fix-daily-provider-operational-qa.md",
    "docs/branch-deltas/fix-resend-email-provider-operational-qa.md",
  ]) {
    assert.equal(exists(path), true, `${path} should remain present`);
  }
  assert.match(read("docs/branch-deltas/fix-resend-email-provider-operational-qa.md"), /Stream 14/);
  assert.match(read("docs/branch-deltas/fix-daily-provider-operational-qa.md"), /Stream 13/);
  assert.match(read("docs/branch-deltas/fix-bunny-provider-operational-qa.md"), /Stream 12/);
});

test("Twilio operational QA docs capture deploy posture and manual dashboard follow-up", () => {
  assert.match(branchDelta, /Supabase linked project: `schdyxcunwcvddlcshwd \/ MVP_Vibe`/);
  assert.match(branchDelta, /`phone-verify`: active/);
  assert.match(branchDelta, /`TWILIO_ACCOUNT_SID`: present by name/);
  assert.match(branchDelta, /No real SMS smoke was run/);
  assert.match(branchDelta, /Edge Function deploy requirement: `phone-verify` changed/);
  assert.match(branchDelta, /Manual Twilio Dashboard Checklist/);
  assert.match(branchDelta, /Verify service SID matches `TWILIO_VERIFY_SERVICE_SID`/);
});
