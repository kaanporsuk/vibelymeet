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

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source section end: ${endMarker}`);
  return source.slice(start, end);
}

const emailVerification = read("supabase/functions/email-verification/index.ts");
const eventNotifications = read("supabase/functions/event-notifications/index.ts");
const sendEmail = read("supabase/functions/send-email/index.ts");
const sendEmailHandler = read("supabase/functions/send-email/handler.ts");
const sendSupportReply = read("supabase/functions/send-support-reply/index.ts");
const webEmailHook = read("src/hooks/useEmailVerification.ts");
const webEmailFlow = read("src/components/verification/EmailVerificationFlow.tsx");
const nativeEmailFlow = read("apps/mobile/components/verification/EmailVerificationFlow.tsx");
const adminEventForm = read("src/components/admin/AdminEventFormModal.tsx");
const supabaseConfig = read("supabase/config.toml");
const notificationDesign = read("docs/notification-system-design.md");
const providerLedger = read("_cursor_context/vibely_external_dependency_ledger.md");
const branchDelta = read("docs/branch-deltas/fix-resend-email-provider-operational-qa.md");
const nativePackageJson = read("apps/mobile/package.json");
const rootPackageJson = read("package.json");

const activeEmailSources = [
  emailVerification,
  eventNotifications,
  sendEmail,
  sendEmailHandler,
  sendSupportReply,
].join("\n");

test("email-verification reads RESEND_API_KEY and sends through Resend", () => {
  assert.match(emailVerification, /Deno\.env\.get\(["']RESEND_API_KEY["']\)/);
  assert.match(emailVerification, /fetchWithProviderTimeout\(["']https:\/\/api\.resend\.com\/emails["'], \{/);
  assert.match(emailVerification, /providerFetchTimeoutMs\(["']resend["'], ["']email_send["'], 8_000\)/);
  assert.match(emailVerification, /Authorization:\s*`Bearer \$\{RESEND_API_KEY\}`/);
  assert.match(emailVerification, /"Vibely <hello@vibelymeet\.com>"/);
  assert.match(supabaseConfig, /\[functions\.email-verification\][\s\S]{0,80}verify_jwt = true/);
});

test("email OTP values are HMAC-hashed before storage and raw OTPs are not logged", () => {
  assert.match(emailVerification, /const OTP_HASH_PREFIX = "h1:"/);
  assert.match(emailVerification, /async function hmacOtpStoredFormWithSecret/);
  assert.match(emailVerification, /HMAC", hash: "SHA-256"/);
  assert.match(emailVerification, /hashedOtp = await hmacOtpStoredForm\(otp\)/);
  assert.match(emailVerification, /code:\s*hashedOtp/);
  assert.match(emailVerification, /otpLength:\s*otp\.length/);
  assert.doesNotMatch(emailVerification, /console\.(?:log|warn|error)[^\n]*(?:\$\{otp\}|otp:\s*otp|code:\s*code)/i);
});

test("email verification verify path checks expiry and attempt limits", () => {
  assert.match(emailVerification, /const MAX_ATTEMPTS = 7/);
  assert.match(emailVerification, /const EMAIL_OTP_VERIFY_FLOW = "email_otp_verify"/);
  assert.match(emailVerification, /\.from\("verification_attempts"\)[\s\S]{0,260}\.eq\("flow", EMAIL_OTP_VERIFY_FLOW\)[\s\S]{0,120}\.gte\("attempt_at", oneHourAgo\)/);
  assert.match(emailVerification, /attemptCount[\s\S]{0,80}MAX_ATTEMPTS/);
  assert.match(emailVerification, /\.from\("email_verifications"\)[\s\S]{0,260}\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(emailVerification, /const isValidCode = await verifyOtpHash\(code, storedCode, requestId\)/);
  assert.match(emailVerification, /\.from\("verification_attempts"\)[\s\S]{0,140}\.insert\(\{ user_id: user\.id, flow: EMAIL_OTP_VERIFY_FLOW \}\)/);
  assert.match(emailVerification, /\.from\("verification_attempts"\)[\s\S]{0,120}\.delete\(\)[\s\S]{0,120}\.eq\("flow", EMAIL_OTP_VERIFY_FLOW\)/);
});

test("event notification email path requires authenticated admin posture", () => {
  assert.match(supabaseConfig, /\[functions\.event-notifications\][\s\S]{0,80}verify_jwt = true/);
  assert.match(eventNotifications, /preflightResponse\(req\)/);
  assert.match(eventNotifications, /isBrowserOriginRejected\(req\)/);
  assert.doesNotMatch(eventNotifications, /Access-Control-Allow-Origin["']:\s*["']\*["']/);
  assert.match(eventNotifications, /authenticateAdminRequest\(req\)/);
  assert.doesNotMatch(eventNotifications, /\.from\("user_roles"\)[\s\S]{0,180}\.eq\("role", "admin"\)/);
  assert.match(eventNotifications, /functionName:\s*"event-notifications"/);
  assert.match(adminEventForm, /supabase\.functions\.invoke\('event-notifications'/);
  assert.match(adminEventForm, /resolveAdminFunctionErrorMessage\(error, data, "Announcement email failed"\)/);
  assert.match(adminEventForm, /Event created, but announcement email did not complete/);
  const notificationInvoke = section(adminEventForm, "const sendCreatedAnnouncement", "if (result.action === 'create_event')");
  assert.doesNotMatch(notificationInvoke, /catch \(_\) \{\}/);
  assert.match(adminEventForm, /await sendCreatedAnnouncement\(\)/);
});

test("event notification sends use Resend, production links, and unsubscribe suppression", () => {
  assert.match(eventNotifications, /Deno\.env\.get\("RESEND_API_KEY"\)/);
  assert.match(eventNotifications, /fetch\("https:\/\/api\.resend\.com\/emails"/);
  assert.match(eventNotifications, /"Vibely <notifications@vibelymeet\.com>"/);
  assert.match(eventNotifications, /\.eq\("email_verified", true\)[\s\S]{0,80}\.eq\("email_unsubscribed", false\)/);
  assert.match(eventNotifications, /https:\/\/www\.vibelymeet\.com\/events\/\$\{safeEventId\}/);
  assert.match(eventNotifications, /escapeHtml/);
  assert.match(eventNotifications, /emailSubjectText/);
  assert.match(eventNotifications, /formatEventDateUtc/);
  assert.match(eventNotifications, /EMAIL_BATCH_SIZE/);
  assert.match(eventNotifications, /event-notifications resend_failed/);
  assert.match(eventNotifications, /bodyLength:\s*error\.length/);
  assert.doesNotMatch(eventNotifications, /Failed to send email to \$\{to\}/);
  assert.match(eventNotifications, /eventNotificationBlockReason/);
  assert.match(eventNotifications, /announcementAudienceSkipReason/);
  assert.match(eventNotifications, /skipped_reason/);
  assert.match(eventNotifications, /restricted_visibility_requires_targeting/);
  assert.match(eventNotifications, /\.from\("event_registrations"\)[\s\S]{0,140}\.eq\("admission_status", "confirmed"\)/);
  assert.match(eventNotifications, /providerNotConfiguredResponse/);
  assert.match(eventNotifications, /email_provider_not_configured/);
  assert.match(eventNotifications, /deliverySummary/);
  assert.match(eventNotifications, /attempted/);
  assert.match(eventNotifications, /failed/);
  assert.match(eventNotifications, /email_delivery_partial_failure/);
  assert.match(eventNotifications, /email_delivery_failed/);
  assert.match(eventNotifications, /return true/);
  assert.match(eventNotifications, /result\.status === "fulfilled" && result\.value === true/);
});

test("email-drip is retired instead of assumed active; CRON_SECRET restoration posture is documented", () => {
  assert.equal(exists("supabase/functions/email-drip/index.ts"), false);
  assert.doesNotMatch(supabaseConfig, /\[functions\.email-drip\]/);
  assert.match(notificationDesign, /email-drip \/ unsubscribe:\*\* retired from current source\/config\/live function inventory/);
  assert.match(providerLedger, /`email-drip` was removed from source\/config and is not active/);
  assert.match(providerLedger, /secret involved if restored: `CRON_SECRET`/);
  assert.match(branchDelta, /`email-drip`: retired from current source\/config and not active/);
  assert.match(branchDelta, /If restoring drip, confirm `CRON_SECRET` scheduler auth/);
});

test("unsubscribe is retired instead of assumed active; UNSUB_HMAC_SECRET restoration posture is documented", () => {
  assert.equal(exists("supabase/functions/unsubscribe/index.ts"), false);
  assert.doesNotMatch(supabaseConfig, /\[functions\.unsubscribe\]/);
  assert.match(providerLedger, /`unsubscribe` was removed from source\/config and is not active/);
  assert.match(providerLedger, /secret involved if restored: `UNSUB_HMAC_SECRET`/);
  assert.match(branchDelta, /`unsubscribe`: retired from current source\/config and not active/);
  assert.match(branchDelta, /If restoring unsubscribe, confirm `UNSUB_HMAC_SECRET` HMAC link generation/);
});

test("active production email links use the canonical vibelymeet.com origin", () => {
  assert.match(emailVerification, /https:\/\/www\.vibelymeet\.com\/vibely-logo-full-gradient\.png/);
  assert.match(eventNotifications, /https:\/\/www\.vibelymeet\.com\/events\/\$\{safeEventId\}/);
  assert.match(sendEmail, /const APP_URL = Deno\.env\.get\("APP_URL"\) \|\| "https:\/\/www\.vibelymeet\.com"/);
  assert.match(branchDelta, /`curl -I -L https:\/\/www\.vibelymeet\.com\/`: HTTP 200/);
  assert.match(branchDelta, /`curl -I -L https:\/\/vibelymeet\.com\/`: HTTP 307 to `https:\/\/www\.vibelymeet\.com\/`, then HTTP 200/);
  assert.doesNotMatch(activeEmailSources, /https:\/\/vibelymeet\.com/);
});

test("active email console logging does not print secret or OTP values", () => {
  for (const line of consoleLines(activeEmailSources)) {
    assert.doesNotMatch(
      line,
      /\$\{RESEND_API_KEY\}|\$\{resendKey\}|\$\{serviceKey\}|RESEND_API_KEY:\s*|serviceKey:\s*|Authorization:\s*`Bearer/i,
      `console line must not print secret values: ${line}`,
    );
    assert.doesNotMatch(
      line,
      /\$\{otp\}|otp:\s*otp|code:\s*code|verification\.code/,
      `console line must not print OTP values: ${line}`,
    );
  }
});

test("email-verification logs avoid recipient PII and raw Resend response bodies", () => {
  assert.match(emailVerification, /resend_request_start[\s\S]{0,140}fromConfigured/);
  assert.doesNotMatch(emailVerification, /resend_request_start[\s\S]{0,180}\bto\b/);
  assert.match(emailVerification, /resend_response[\s\S]{0,220}providerId/);
  assert.match(emailVerification, /resend_response[\s\S]{0,220}providerRequestId/);
  assert.match(emailVerification, /resend_response[\s\S]{0,220}bodyLength/);
  assert.doesNotMatch(emailVerification, /resend_response[\s\S]{0,220}\bbody:\s*responseBody/);
  assert.doesNotMatch(emailVerification, /jwtUserEmail|jwtAuthEmail:\s|canonicalAuthEmail:\s/);
  for (const line of consoleLines(emailVerification)) {
    assert.doesNotMatch(line, /email:\s*authEmail|authEmail|requestedEmail|canonicalAuthEmail|jwtAuthEmail/);
  }
  assert.doesNotMatch(emailVerification, /OTP sent successfully to|Verifying OTP for user \$\{user\.id\}, email:/);
  assert.match(emailVerification, /requestedEmailPresent/);
  assert.match(emailVerification, /requestedMatchesCanonical/);
});

test("web and native email verification flows remain backend-gated", () => {
  assert.match(webEmailHook, /supabase\.functions\.invoke\("email-verification\/send"/);
  assert.match(webEmailHook, /supabase\.functions\.invoke\("email-verification\/verify"/);
  assert.match(webEmailFlow, /useEmailVerification\(\)/);
  assert.match(nativeEmailFlow, /supabase\.functions\.invoke\('email-verification\/send'/);
  assert.match(nativeEmailFlow, /supabase\.functions\.invoke\('email-verification\/verify'/);
  assert.match(nativeEmailFlow, /resolveSupabaseFunctionErrorMessage/);
});

test("Stream 14 does not add env vars, migrations, native modules, expo-av, or unrelated provider contracts", () => {
  assert.deepEqual(envNames(activeEmailSources), [
    "APP_URL",
    "EMAIL_VERIFICATION_FROM_EMAIL",
    "EMAIL_VERIFICATION_OTP_SECRET",
    "FROM_EMAIL",
    "RESEND_API_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
  ]);
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => name.includes("resend_email_provider_operational_qa")),
    false,
  );
  assert.doesNotMatch(rootPackageJson, /"expo-av"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);
  const nativeCodeFiles = readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]));
  for (const path of nativeCodeFiles) {
    assert.doesNotMatch(
      read(path),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
  assert.match(branchDelta, /No new env vars were added/);
  assert.match(branchDelta, /No native modules added/);
  assert.match(branchDelta, /No `expo-av` import or package added/);
  assert.match(branchDelta, /No Ready Gate, swipe, payment, realtime, OneSignal, Bunny, Daily, RevenueCat, or Twilio changes were made/);
});

test("Streams 1-13 artifacts remain present", () => {
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
    "docs/branch-deltas/fix-onesignal-provider-operational-qa.md",
    "docs/branch-deltas/fix-bunny-provider-operational-qa.md",
    "docs/branch-deltas/fix-daily-provider-operational-qa.md",
  ]) {
    assert.equal(exists(path), true, `${path} should remain present`);
  }
  assert.match(read("docs/branch-deltas/fix-daily-provider-operational-qa.md"), /Stream 13/);
  assert.match(read("docs/branch-deltas/fix-bunny-provider-operational-qa.md"), /Stream 12/);
  assert.match(read("docs/branch-deltas/fix-onesignal-provider-operational-qa.md"), /Stream 11/);
});

test("Resend operational QA docs capture deployment and manual dashboard follow-up", () => {
  assert.match(branchDelta, /Stream 14 Supabase migration requirement was none/);
  assert.match(branchDelta, /Sprint 6 now adds `verification_attempts\.flow`/);
  assert.match(branchDelta, /supabase functions deploy email-verification --project-ref schdyxcunwcvddlcshwd/);
  assert.match(branchDelta, /Edge Function deploy requirement: `event-notifications` changed/);
  assert.match(branchDelta, /No production email was sent/);
  assert.match(branchDelta, /Manual Resend Dashboard Checklist/);
  assert.match(branchDelta, /Confirm `vibelymeet\.com` is verified in Resend/);
  assert.match(branchDelta, /Controlled internal Resend email QA with owned test recipients/);
});
