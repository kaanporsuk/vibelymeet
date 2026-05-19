import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  getMediaBackgroundUploadPolicy,
  MEDIA_BACKGROUND_UPLOAD_POLICY,
  shouldEnableOsBackgroundUploads,
} from ".";

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

test("Phase 7 OS-level background uploads stay research-only until measured platform gates pass", () => {
  const policy = getMediaBackgroundUploadPolicy();

  assert.equal(policy, MEDIA_BACKGROUND_UPLOAD_POLICY);
  assert.equal(policy.phase, "phase_7_background_upload_spike");
  assert.equal(policy.productionCutover, "no_go_research_only");
  assert.equal(policy.productionEnabled, false);
  assert.equal(shouldEnableOsBackgroundUploads(), false);
  assert.equal(policy.sourceOfTruth, "phase_1_6_foreground_persistent_queue_and_recovery");

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
  assert.ok(policy.manualOnlyGates.some((gate) => /native rebuild/i.test(gate)));
  assert.ok(policy.manualOnlyGates.some((gate) => /OneSignal root service-worker/i.test(gate)));
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
  assert.doesNotMatch(modes.join("\n"), /^fetch$/m);
  assert.doesNotMatch(modes.join("\n"), /^processing$/m);
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
  ]) {
    assert.match(decision, new RegExp(required, "i"));
  }

  assert.match(decision, />= 95 percent/);
  assert.match(decision, /Zero duplicate assets/);
  assert.match(canonicalPlan, /decision\/bg-uploads-go-no-go/);
  assert.match(canonicalPlan, /NO-GO research-only/);
  assert.match(canonicalPlan, /media-background-upload-phase7-decision\.md/);
});
