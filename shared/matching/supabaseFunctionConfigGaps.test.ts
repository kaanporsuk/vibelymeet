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

function listFunctionDirs(): string[] {
  return readdirSync(join(root, "supabase/functions"))
    .filter((name) => name !== "_shared")
    .filter((name) => statSync(join(root, "supabase/functions", name)).isDirectory())
    .sort();
}

function listConfiguredFunctions(config: string): string[] {
  return Array.from(config.matchAll(/^\[functions\.([^\]]+)\]$/gm), (match) => match[1]).sort();
}

function getFunctionConfigBlock(config: string, slug: string): string {
  const match = config.match(new RegExp(`(?:^|\\n)(?:#[^\\n]*\\n)*\\[functions\\.${slug}\\]\\nverify_jwt = (?:true|false)`, "m"));
  assert.ok(match, `${slug} should be explicitly represented in supabase/config.toml`);
  return match[0];
}

function envNames(source: string): string[] {
  return Array.from(source.matchAll(/Deno\.env\.get\(["']([^"']+)["']\)/g), (match) => match[1]).sort();
}

function readTreeFiles(
  dir: string,
  extensions: ReadonlySet<string>,
  ignored = new Set(["node_modules", ".expo", ".next", "dist", "build", "Pods"]),
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

const supabaseConfig = read("supabase/config.toml");
const forwardGeocode = read("supabase/functions/forward-geocode/index.ts");
const pushWebhook = read("supabase/functions/push-webhook/index.ts");
const edgeManifest = read("_cursor_context/vibely_edge_function_manifest.md");
const providerSheet = read("_cursor_context/vibely_supabase_provider_sheet.md");
const dependencyLedger = read("_cursor_context/vibely_external_dependency_ledger.md");
const branchDeltaPath = "docs/branch-deltas/fix-supabase-function-config-gaps.md";
const branchDelta = read(branchDeltaPath);
const rootPackageJson = read("package.json");
const nativePackageJson = read("apps/mobile/package.json");

test("forward-geocode and push-webhook source functions exist", () => {
  assert.equal(exists("supabase/functions/forward-geocode/index.ts"), true);
  assert.equal(exists("supabase/functions/push-webhook/index.ts"), true);
});

test("all deployable functions are explicitly represented in supabase config", () => {
  const functionDirs = listFunctionDirs();
  const configured = listConfiguredFunctions(supabaseConfig);
  assert.deepEqual(configured, functionDirs);
  assert.equal(functionDirs.length, 53);
  assert.match(edgeManifest, /\*\*53\*\* deployable function directories and \*\*53\*\* matching/);
  assert.match(providerSheet, /Deployable functions: \*\*53\*\*/);
  assert.match(dependencyLedger, /all 53 deployable functions are in `supabase\/config\.toml`/);
});

test("intended gateway JWT posture is explicit and documented", () => {
  const forwardBlock = getFunctionConfigBlock(supabaseConfig, "forward-geocode");
  const pushBlock = getFunctionConfigBlock(supabaseConfig, "push-webhook");

  assert.match(forwardBlock, /Authenticated city-search proxy/);
  assert.match(forwardBlock, /verify_jwt = true/);
  assert.match(forwardBlock, /admin\/premium\/onboarding access/);
  assert.match(forwardBlock, /OpenStreetMap Nominatim/);

  assert.match(pushBlock, /External receipt telemetry endpoint/);
  assert.match(pushBlock, /verify_jwt = false/);
  assert.match(pushBlock, /x-webhook-secret matches PUSH_WEBHOOK_SECRET/);

  assert.match(edgeManifest, /`forward-geocode`:[\s\S]{0,260}`verify_jwt = true`/);
  assert.match(edgeManifest, /`push-webhook`:[\s\S]{0,260}`verify_jwt = false`/);
  assert.match(branchDelta, /`forward-geocode`: `verify_jwt = true`/);
  assert.match(branchDelta, /`push-webhook`: `verify_jwt = false`/);
});

test("push-webhook remains secret-gated external telemetry", () => {
  assert.deepEqual(envNames(pushWebhook), [
    "PUSH_WEBHOOK_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
  ]);
  assert.match(pushWebhook, /Deno\.env\.get\(["']PUSH_WEBHOOK_SECRET["']\)/);
  assert.match(pushWebhook, /Require PUSH_WEBHOOK_SECRET \(fail closed\)/);
  assert.match(pushWebhook, /req\.headers\.get\(["']x-webhook-secret["']\)/);
  assert.match(pushWebhook, /status:\s*503/);
  assert.match(pushWebhook, /status:\s*401/);
  assert.match(pushWebhook, /push_notification_events/);
  assert.match(pushWebhook, /provider: "fcm" \| "apns" \| "web"/);
  assert.doesNotMatch(pushWebhook, /OneSignal|ONESIGNAL/);
  assert.doesNotMatch(pushWebhook, /console\.(?:log|warn|error)\([^)]*(providedSecret|webhookSecret|x-webhook-secret)[^)]*\)/);
  assert.match(branchDelta, /generic FCM\/APNs\/web receipt telemetry/);
  assert.match(branchDelta, /not proven wired to OneSignal receipts/);
});

test("forward-geocode remains authenticated, user-gated, rate-limited city search", () => {
  assert.deepEqual(envNames(forwardGeocode), [
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
  ]);
  assert.match(forwardGeocode, /req\.headers\.get\(["']Authorization["']\)/);
  assert.match(forwardGeocode, /supabaseUser\.auth\.getUser\(\)/);
  assert.match(forwardGeocode, /canUsePremiumGeocode/);
  assert.match(forwardGeocode, /canUseOnboardingGeocode/);
  assert.match(forwardGeocode, /checkRateLimit\(user\.id/);
  assert.match(forwardGeocode, /RATE_LIMIT_REQUESTS = 30/);
  assert.match(forwardGeocode, /featuretype=settlement/);
  assert.match(forwardGeocode, /nominatim\.openstreetmap\.org\/search/);
  assert.match(forwardGeocode, /User-Agent/);
  for (const path of [
    "src/components/admin/AdminEventFormModal.tsx",
    "src/pages/onboarding/steps/LocationStep.tsx",
    "src/components/events/EventsFilterBar.tsx",
    "src/components/settings/DiscoveryDrawer.tsx",
    "apps/mobile/components/onboarding/steps/LocationStep.tsx",
    "apps/mobile/components/events/EventFilterSheet.tsx",
    "apps/mobile/app/settings/discovery.tsx",
  ]) {
    assert.match(read(path), /supabase\.functions\.invoke\(['"]forward-geocode['"]/, `${path} should use forward-geocode`);
  }
  assert.match(branchDelta, /admin\/premium\/onboarding city search/);
});

test("deploy posture is documented without adding a database migration or env var", () => {
  assert.equal(exists(branchDeltaPath), true);
  assert.match(branchDelta, /Deploy required after merge: yes/);
  assert.match(branchDelta, /supabase functions deploy forward-geocode --project-ref schdyxcunwcvddlcshwd/);
  assert.match(branchDelta, /supabase functions deploy push-webhook --project-ref schdyxcunwcvddlcshwd/);
  assert.match(branchDelta, /Supabase DB push: not required/);
  assert.match(branchDelta, /Env var changes: none/);
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => /function_config_gaps|forward_geocode|push_webhook/i.test(name)),
    false,
    "Stream 19 should not add a Supabase migration",
  );
});

test("Stream 19 adds no native modules or expo-av usage", () => {
  assert.doesNotMatch(rootPackageJson, /"expo-av"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);
  const nativeFiles = readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]));
  for (const path of nativeFiles) {
    assert.doesNotMatch(
      read(path),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
  assert.match(branchDelta, /Native modules: none/);
  assert.match(branchDelta, /`expo-av`: not imported or required/);
});

test("Streams 1-18 artifacts remain present", () => {
  for (const path of [
    "supabase/migrations/20260501180000_event_lobby_active_event_contract.sql",
    "shared/matching/readyGateTransitionExpiryRowcount.test.ts",
    "shared/matching/readyGateEventEndedTerminalization.test.ts",
    "shared/matching/readyGateContractConsumerCompliance.test.ts",
    "shared/matching/readyGateTerminalUxObservability.test.ts",
    "shared/matching/nativeReadyGateParityContract.test.ts",
    "shared/matching/realtimeSubscriptionTightening.test.ts",
    "shared/matching/premiumCreditsObservability.test.ts",
    "shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts",
    "shared/matching/nativeVideoDateContractRecovery.test.ts",
    "shared/matching/onesignalProviderOperationalQa.test.ts",
    "shared/matching/bunnyProviderOperationalQa.test.ts",
    "shared/matching/dailyProviderOperationalQa.test.ts",
    "shared/matching/resendEmailProviderOperationalQa.test.ts",
    "shared/matching/twilioPhoneVerificationQa.test.ts",
    "shared/matching/nativePhysicalDeviceQaReadiness.test.ts",
    "shared/matching/revenueCatNativeEntitlementReadiness.test.ts",
    "shared/matching/screenshotLedNativeVisualParity.test.ts",
    "docs/branch-deltas/fix-screenshot-led-native-visual-parity.md",
  ]) {
    assert.equal(exists(path), true, `${path} should remain present`);
  }
});
