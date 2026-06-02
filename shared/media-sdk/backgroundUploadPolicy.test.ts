import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  MEDIA_BACKGROUND_UPLOAD_CANDIDATES,
  getMediaBackgroundUploadPolicy,
  mediaBackgroundUploadPolicyReviewWarning,
  mediaBackgroundUploadPolicyTelemetryFields,
  MEDIA_BACKGROUND_UPLOAD_POLICY,
  shouldEnableOsBackgroundUploads,
} from ".";
import { sanitizeProductIntelligenceProperties } from "../analytics/productIntelligence";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(read(path)) as Record<string, unknown>;
}

function dependenciesOf(packageJsonPath: string): Record<string, string> {
  const pkg = readJson(packageJsonPath);
  return {
    ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg.optionalDependencies as Record<string, string> | undefined) ?? {}),
  };
}

function packageLockModules(packageLockPath: string): Record<string, unknown> {
  const lock = readJson(packageLockPath);
  return (lock.packages as Record<string, unknown> | undefined) ?? {};
}

function runtimeFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return runtimeFilesUnder(path);
    if (!entry.isFile() || !/\.(ts|tsx|js|jsx)$/.test(entry.name)) return [];
    return [path];
  });
}

function runtimeSourceCorpus(paths: readonly string[]): string {
  return paths
    .flatMap((path) => runtimeFilesUnder(path))
    .map((path) => `\n--- ${path} ---\n${read(path)}`)
    .join("\n");
}

function plistArrayForKey(path: string, key: string): string[] {
  const text = read(path);
  const match = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(text);
  if (!match) return [];
  return Array.from(match[1].matchAll(/<string>([^<]+)<\/string>/g), (entry) => entry[1]);
}

test("Phase 7 OS-level background uploads stay research-only until measured platform gates pass", () => {
  const policy = getMediaBackgroundUploadPolicy();

  assert.equal(policy, MEDIA_BACKGROUND_UPLOAD_POLICY);
  assert.equal(policy.phase, "phase_7_background_upload_spike");
  assert.equal(policy.decidedAt, "2026-05-19");
  assert.equal(policy.reviewAfter, "2026-11-19");
  assert.equal(policy.productionCutover, "no_go_research_only");
  assert.equal(policy.productionEnabled, false);
  assert.equal(shouldEnableOsBackgroundUploads(), false);
  assert.equal(policy.sourceOfTruth, "phase_1_6_foreground_persistent_queue_and_recovery");
  assert.equal(mediaBackgroundUploadPolicyReviewWarning(Date.parse("2026-11-19T23:59:59.999Z")), null);
  assert.match(
    mediaBackgroundUploadPolicyReviewWarning(Date.parse("2026-11-20T00:00:00.000Z")) ?? "",
    /review is overdue/,
  );

  for (const platform of ["web", "ios", "android"] as const) {
    assert.equal(policy.platforms[platform].productionEnabled, false);
    assert.equal(policy.platforms[platform].prototypeOnly, true);
    assert.ok(policy.platforms[platform].blockingRisks.length >= 4);
    assert.ok(policy.platforms[platform].requiredManualProof.length >= 4);
    assert.ok(policy.platforms[platform].goCriteria.length >= 3);
  }

  assert.match(policy.platforms.web.candidate, /service_worker_background_sync/);
  assert.match(policy.platforms.ios.candidate, /urlsession|bgprocessing/i);
  assert.match(policy.platforms.android.candidate, /workmanager|foreground_service/i);
  assert.equal(policy.platforms.web.candidate, MEDIA_BACKGROUND_UPLOAD_CANDIDATES.web);
  assert.equal(policy.platforms.ios.candidate, MEDIA_BACKGROUND_UPLOAD_CANDIDATES.ios);
  assert.equal(policy.platforms.android.candidate, MEDIA_BACKGROUND_UPLOAD_CANDIDATES.android);
  assert.ok(policy.manualOnlyGates.some((gate) => /native rebuild/i.test(gate)));
  assert.ok(policy.manualOnlyGates.some((gate) => /OneSignal root service-worker/i.test(gate)));

  const telemetry = mediaBackgroundUploadPolicyTelemetryFields();
  assert.equal(telemetry.background_upload_policy_phase, policy.phase);
  assert.equal(telemetry.background_upload_production_enabled, false);
  assert.equal(telemetry.background_upload_decided_at, policy.decidedAt);
  assert.equal(telemetry.background_upload_review_after, policy.reviewAfter);
  assert.equal(telemetry.background_upload_source_of_truth, policy.sourceOfTruth);
  assert.deepEqual(sanitizeProductIntelligenceProperties(telemetry, { platform: "web" }), {
    platform: "web",
    background_upload_policy_phase: policy.phase,
    background_upload_production_enabled: false,
    background_upload_decided_at: policy.decidedAt,
    background_upload_review_after: policy.reviewAfter,
    background_upload_source_of_truth: policy.sourceOfTruth,
  });
});

test("Phase 7 does not introduce runtime background upload dependencies or service-worker registration", () => {
  const rootDeps = dependenciesOf("package.json");
  const mobileDeps = dependenciesOf("apps/mobile/package.json");
  const lockedModules = {
    ...packageLockModules("package-lock.json"),
    ...packageLockModules("apps/mobile/package-lock.json"),
  };

  for (const forbidden of [
    "expo-background-task",
    "expo-task-manager",
    "workbox-background-sync",
    "workbox-window",
  ]) {
    assert.equal(rootDeps[forbidden], undefined, `${forbidden} must not be added to the web package yet`);
    assert.equal(mobileDeps[forbidden], undefined, `${forbidden} must not be added to the native package yet`);
    assert.equal(
      lockedModules[`node_modules/${forbidden}`],
      undefined,
      `${forbidden} must not be installed into lockfiles for Phase 7`,
    );
  }

  const oneSignalClient = read("src/lib/onesignal.ts");
  assert.match(oneSignalClient, /serviceWorkerParam:\s*\{\s*scope:\s*"\/"\s*\}/);

  const serviceWorkerHook = read("src/hooks/useServiceWorker.ts");
  assert.match(serviceWorkerHook, /We no longer register public\/sw\.js/);
  assert.doesNotMatch(serviceWorkerHook, /navigator\.serviceWorker\.register/);

  assert.match(read("public/OneSignalSDK.sw.js"), /cdn\.onesignal\.com\/sdks\/web\/v16\/OneSignalSDK\.sw\.js/);
  assert.match(read("public/OneSignalSDKWorker.js"), /cdn\.onesignal\.com\/sdks\/web\/v16\/OneSignalSDK\.sw\.js/);
  assert.doesNotMatch(read("public/sw.js"), /OneSignalSDK|background sync|SyncManager/i);
});

test("web runtime source does not register a media service worker or Background Sync hook", () => {
  const webRuntime = runtimeSourceCorpus(["src"]);

  assert.doesNotMatch(webRuntime, /navigator\.serviceWorker\.register/);
  assert.doesNotMatch(webRuntime, /serviceWorker\.register/);
  assert.doesNotMatch(webRuntime, /\.sync\.register\(/);
  assert.doesNotMatch(webRuntime, /periodicSync\.register\(/);
});

test("native runtime source does not define OS background upload tasks", () => {
  const nativeRuntime = [
    runtimeSourceCorpus(["apps/mobile/app", "apps/mobile/components", "apps/mobile/hooks", "apps/mobile/lib"]),
    `\n--- apps/mobile/app.config.js ---\n${read("apps/mobile/app.config.js")}`,
    `\n--- apps/mobile/app.base.json ---\n${read("apps/mobile/app.base.json")}`,
  ].join("\n");

  assert.doesNotMatch(nativeRuntime, /expo-background-task/);
  assert.doesNotMatch(nativeRuntime, /expo-task-manager/);
  assert.doesNotMatch(nativeRuntime, /TaskManager\.defineTask/);
  assert.doesNotMatch(nativeRuntime, /BackgroundTask\./);
  assert.doesNotMatch(nativeRuntime, /BGTaskSchedulerPermittedIdentifiers/);
  assert.doesNotMatch(nativeRuntime, /WorkManager/);
});

test("native app config does not request background upload execution modes", () => {
  const appBase = readJson("apps/mobile/app.base.json");
  const expo = appBase.expo as { ios?: { infoPlist?: { UIBackgroundModes?: unknown } } } | undefined;
  const modes = expo?.ios?.infoPlist?.UIBackgroundModes;

  assert.ok(Array.isArray(modes));
  assert.deepEqual(modes, ["remote-notification", "audio"]);
  assert.doesNotMatch(modes.join("\n"), /^voip$/m);
  assert.doesNotMatch(modes.join("\n"), /^fetch$/m);
  assert.doesNotMatch(modes.join("\n"), /^processing$/m);

  assert.equal(
    existsSync("apps/mobile/ios/mobile/Info.plist"),
    false,
    "stale unreferenced ios/mobile/Info.plist must not be checked in",
  );
  const plistPaths = ["apps/mobile/ios/Vibely/Info.plist"];
  assert.ok(existsSync(plistPaths[0]), "app Info.plist must be present for UIBackgroundModes parity");
  for (const plistPath of plistPaths) {
    assert.deepEqual(
      plistArrayForKey(plistPath, "UIBackgroundModes"),
      modes,
      `${plistPath} UIBackgroundModes must match apps/mobile/app.base.json exactly`,
    );
  }

  assert.match(read("apps/mobile/app.base.json"), /@daily-co\/config-plugin-rn-daily-js/);
  assert.match(read("docs/media-background-upload-phase7-decision.md"), /does not include a PushKit\/PKPush incoming-call stack/);
  assert.match(read("docs/media-background-upload-phase7-decision.md"), /active-call media continuity/);
  assert.match(read("docs/media-background-upload-phase7-decision.md"), /Neither mode is a media-upload execution mode/);
});

test("Phase 7 decision documents the no-go call, platform risks, and future measured floors", () => {
  const decision = read("docs/media-background-upload-phase7-decision.md");
  const canonicalPlan = read("docs/media_management_ultimate_improvement.md");

  for (const required of [
    "NO-GO",
    "Background Sync",
    "OneSignal",
    "BGProcessing",
    "URLSession",
    "WorkManager",
    "measured floors",
    "foreground persistent queue",
    "TUS",
    "reviewAfter",
    "Service-Worker-Allowed",
  ]) {
    assert.match(decision, new RegExp(required, "i"));
  }

  assert.match(decision, />= 95 percent/);
  assert.match(decision, /Zero duplicate assets/);
  assert.match(canonicalPlan, /decision\/bg-uploads-go-no-go/);
  assert.match(canonicalPlan, /NO-GO research-only/);
  assert.match(canonicalPlan, /media-background-upload-phase7-decision\.md/);
});

test("native release readiness notes do not collide with the media Phase 7 namespace", () => {
  const legacyTopLevelPhase7Docs = readdirSync("docs")
    .filter((name) => /^phase7-/i.test(name))
    .sort();
  assert.deepEqual(legacyTopLevelPhase7Docs, []);

  const nativeReadinessIndex = read("docs/native-release-readiness/README.md");
  assert.match(nativeReadinessIndex, /native app release readiness/i);
  assert.match(nativeReadinessIndex, /separated from the v9 media Phase 7 background-upload decision/i);
  assert.match(nativeReadinessIndex, /docs\/media-background-upload-phase7-decision\.md/);
});

test("Phase 7 policy test is wired directly into CI", () => {
  const packageJson = readJson("package.json");
  const scripts = packageJson.scripts as Record<string, string>;
  assert.equal(scripts["test:media-background-upload"], "tsx shared/media-sdk/backgroundUploadPolicy.test.ts");

  const workflow = read(".github/workflows/phase-7-media-background-policy.yml");
  assert.match(workflow, /npm run test:media-background-upload/);
  assert.match(workflow, /shared\/media-sdk\/backgroundUploadPolicy\.test\.ts/);
  assert.match(workflow, /apps\/mobile\/\*\*/);
  assert.match(workflow, /src\/\*\*/);
  assert.match(workflow, /shared\/media-sdk\/\*\*/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
});
