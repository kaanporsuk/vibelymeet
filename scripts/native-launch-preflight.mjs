/**
 * Repo-side checks before native launch-closure operator work.
 * Does not call provider APIs or EAS (no secrets required).
 * Usage: npm run launch:preflight
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MOBILE = join(ROOT, "apps", "mobile");

const REQUIRED_DOCS = [
  "docs/native-launch-closure-master-runbook.md",
  "docs/kaan-launch-closure-execution-sheet.md",
  "docs/native-external-setup-checklist.md",
  "docs/native-sprint6-launch-closure-runbook.md",
  "docs/native-release-readiness/stage5-release-readiness-and-go-nogo.md",
  "docs/native-release-readiness.md",
  "docs/native-final-blocker-matrix.md",
  "docs/browser-auth-runtime-proof-results.md",
  "docs/fresh-smoke-proof-bootstrap.md",
];

/** EXPO_PUBLIC vars to set as EAS secrets for preview/production (from apps/mobile/.env.example + IAP/push). */
const LAUNCH_CRITICAL_ENV_KEYS = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_ONESIGNAL_APP_ID",
  "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY",
  "EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY",
];
const ONESIGNAL_APP_GROUP = "group.com.vibelymeet.vibely.onesignal";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function phase7BackgroundUploadPolicyReviewWarning() {
  const policyPath = join(ROOT, "shared", "media-sdk", "background-upload-policy.ts");
  if (!existsSync(policyPath)) {
    return `Missing ${policyPath}; cannot verify Phase 7 background-upload policy review cadence.`;
  }
  const policy = readText(policyPath);
  const exposesReviewAfter = /reviewAfter:\s*MEDIA_BACKGROUND_UPLOAD_REVIEW_AFTER|reviewAfter:\s*"[^"]+"/.test(policy);
  const explicitDate =
    /MEDIA_BACKGROUND_UPLOAD_REVIEW_AFTER\s*=\s*"([^"]+)"/.exec(policy)?.[1] ??
    /reviewAfter:\s*"([^"]+)"/.exec(policy)?.[1] ??
    null;
  if (!exposesReviewAfter || !explicitDate) {
    return "Phase 7 background-upload policy must expose reviewAfter for launch preflight visibility.";
  }
  const reviewAfterMs = Date.parse(`${explicitDate}T23:59:59.999Z`);
  if (!Number.isFinite(reviewAfterMs)) {
    return `Phase 7 background-upload policy reviewAfter is not a parseable date: ${explicitDate}`;
  }
  if (Date.now() > reviewAfterMs) {
    return `Phase 7 background-upload NO-GO decision is overdue for review; reviewAfter=${explicitDate}.`;
  }
  return null;
}

function readResolvedExpoConfig(errors, profile) {
  const appBasePath = join(MOBILE, "app.base.json");
  const appConfigPath = join(MOBILE, "app.config.js");

  if (!existsSync(appBasePath)) {
    errors.push(`Missing ${appBasePath}`);
  }
  if (!existsSync(appConfigPath)) {
    errors.push(`Missing ${appConfigPath}`);
  }
  if (!existsSync(appBasePath) || !existsSync(appConfigPath)) {
    return null;
  }

  try {
    const env = { ...process.env };
    if (profile) {
      env.EAS_BUILD_PROFILE = profile;
    } else {
      delete env.EAS_BUILD_PROFILE;
    }
    const raw = execFileSync("npx", ["expo", "config", "--json"], {
      cwd: MOBILE,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(raw);
  } catch (error) {
    const stderr =
      typeof error?.stderr === "string"
        ? error.stderr
        : error?.stderr?.toString?.("utf8");
    const detail = stderr?.trim() || error?.message || "unknown error";
    const label = profile ? `${profile} Expo config` : "default Expo config";
    errors.push(`Unable to resolve ${label} via "npx expo config --json": ${detail}`);
    return null;
  }
}

function pluginOptions(app, name) {
  const plugin = (app?.plugins || []).find((entry) => (
    Array.isArray(entry) ? entry[0] === name : entry === name
  ));
  return Array.isArray(plugin) ? plugin[1] || {} : {};
}

function main() {
  const errors = [];
  const warnings = [];
  const info = [];

  const phase7ReviewWarning = phase7BackgroundUploadPolicyReviewWarning();
  if (phase7ReviewWarning) warnings.push(phase7ReviewWarning);

  const app = readResolvedExpoConfig(errors);
  const previewApp = readResolvedExpoConfig(errors, "preview");
  const productionApp = readResolvedExpoConfig(errors, "production");
  if (app) {
    const iosId = app?.ios?.bundleIdentifier;
    const androidPkg = app?.android?.package;
    const scheme = app?.scheme;
    const expected = "com.vibelymeet.vibely";
    if (iosId !== expected) {
      errors.push(`ios.bundleIdentifier expected ${expected}, got ${iosId}`);
    }
    if (androidPkg !== expected) {
      errors.push(`android.package expected ${expected}, got ${androidPkg}`);
    }
    if (iosId && androidPkg && iosId !== androidPkg) {
      errors.push(`iOS bundle id !== Android package (${iosId} vs ${androidPkg})`);
    }
    if (scheme && scheme !== expected) {
      warnings.push(
        `expo.scheme is "${scheme}" (often matches app id for deep links; verify intent filters / universal links).`,
      );
    }
    const aps = app?.ios?.entitlements?.["aps-environment"];
    if (aps === "development") {
      info.push(
        "Resolved Expo config entitlements aps-environment is development; EAS preview/production builds still use OneSignal production APNs via app.config.js — confirm with docs/kaan-launch-closure-execution-sheet.md § OneSignal.",
      );
    }
    const appGroups = app?.ios?.entitlements?.["com.apple.security.application-groups"];
    if (!Array.isArray(appGroups) || !appGroups.includes(ONESIGNAL_APP_GROUP)) {
      errors.push(`Expo config ios.entitlements must include OneSignal app group ${ONESIGNAL_APP_GROUP}`);
    }
    const oneSignalExtensions =
      app?.extra?.eas?.build?.experimental?.ios?.appExtensions?.filter(
        (extension) => extension?.bundleIdentifier === `${expected}.OneSignalNotificationServiceExtension`,
      ) || [];
    if (oneSignalExtensions.length !== 1) {
      errors.push(`Resolved Expo config should contain exactly one OneSignal extension, got ${oneSignalExtensions.length}`);
    }
    const extensionGroups =
      oneSignalExtensions[0]?.entitlements?.["com.apple.security.application-groups"];
    if (!Array.isArray(extensionGroups) || !extensionGroups.includes(ONESIGNAL_APP_GROUP)) {
      errors.push(`Resolved OneSignal extension entitlements must include app group ${ONESIGNAL_APP_GROUP}`);
    }
    const localOneSignalMode = pluginOptions(app, "onesignal-expo-plugin").mode;
    if (localOneSignalMode !== "development") {
      errors.push(`Default OneSignal plugin mode expected development, got ${localOneSignalMode}`);
    }
    const generatedMainEntitlements = join(MOBILE, "ios", "Vibely", "Vibely.entitlements");
    if (existsSync(generatedMainEntitlements)) {
      const text = readText(generatedMainEntitlements);
      if (!text.includes(ONESIGNAL_APP_GROUP)) {
        errors.push(`Generated Vibely.entitlements is missing ${ONESIGNAL_APP_GROUP}`);
      }
    }
    const generatedExtensionEntitlements = join(
      MOBILE,
      "ios",
      "OneSignalNotificationServiceExtension",
      "OneSignalNotificationServiceExtension.entitlements",
    );
    if (existsSync(generatedExtensionEntitlements)) {
      const text = readText(generatedExtensionEntitlements);
      if (!text.includes(ONESIGNAL_APP_GROUP)) {
        errors.push(`Generated OneSignal extension entitlements is missing ${ONESIGNAL_APP_GROUP}`);
      }
    }
    const sceneManifest = app?.ios?.infoPlist?.UIApplicationSceneManifest;
    if (sceneManifest && !sceneManifest.UISceneConfigurations) {
      info.push(
        "UIScene manifest is currently single-scene only; keep the Apple UIScene lifecycle migration tracked for the next native-template pass.",
      );
    }
  }

  if (previewApp) {
    const previewOneSignalMode = pluginOptions(previewApp, "onesignal-expo-plugin").mode;
    if (previewOneSignalMode !== "production") {
      errors.push(`Preview OneSignal plugin mode expected production, got ${previewOneSignalMode}`);
    }
  }

  if (productionApp) {
    const productionOneSignalMode = pluginOptions(productionApp, "onesignal-expo-plugin").mode;
    if (productionOneSignalMode !== "production") {
      errors.push(`Production OneSignal plugin mode expected production, got ${productionOneSignalMode}`);
    }
  }

  const easPath = join(MOBILE, "eas.json");
  if (!existsSync(easPath)) {
    errors.push(`Missing ${easPath}`);
  } else {
    const eas = readJson(easPath);
    for (const profile of ["development", "preview", "production"]) {
      if (!eas?.build?.[profile]) {
        errors.push(`eas.json missing build.${profile}`);
      }
    }
    if (eas?.build?.preview?.distribution !== "internal") {
      warnings.push("eas preview profile: expected distribution internal for internal install flow.");
    }
    if (eas?.build?.production?.distribution !== "store") {
      warnings.push("eas production profile: expected distribution store for store submission.");
    }
  }

  const appConfigPath = join(MOBILE, "app.config.js");
  if (!existsSync(appConfigPath)) {
    errors.push(`Missing ${appConfigPath}`);
  } else {
    const cfg = readText(appConfigPath);
    if (!cfg.includes("EAS_BUILD_PROFILE")) {
      errors.push("app.config.js should reference EAS_BUILD_PROFILE for OneSignal mode.");
    }
    if (!cfg.includes("preview") || !cfg.includes("production")) {
      errors.push("app.config.js should branch preview/production for OneSignal mode.");
    }
  }

  const envExample = join(MOBILE, ".env.example");
  if (!existsSync(envExample)) {
    errors.push(`Missing ${envExample}`);
  } else {
    const exampleText = readText(envExample);
    for (const key of ["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
      if (!exampleText.includes(key)) {
        errors.push(`.env.example should document ${key}`);
      }
    }
  }

  for (const rel of REQUIRED_DOCS) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
      errors.push(`Missing required doc: ${rel}`);
    }
  }

  const pkgPath = join(ROOT, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = readJson(pkgPath);
    if (!pkg.scripts?.["launch:preflight"]) {
      errors.push('package.json missing scripts["launch:preflight"]');
    }
    if (!pkg.scripts?.["proof:smoke-bootstrap"]) {
      warnings.push(
        "package.json missing proof:smoke-bootstrap (optional repo-side browser/smoke proof).",
      );
    }
  }

  let easCli = false;
  try {
    execFileSync("eas", ["--version"], { stdio: "pipe", encoding: "utf8" });
    easCli = true;
  } catch {
    warnings.push(
      "EAS CLI not on PATH — install for builds (`npm i -g eas-cli`). Preflight cannot verify cloud secrets.",
    );
  }

  const out = {
    ok: errors.length === 0,
    root: ROOT,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    info,
    easCliDetected: easCli,
    launchCriticalEnvKeysForEAS: LAUNCH_CRITICAL_ENV_KEYS,
    note: "Mirror these EXPO_PUBLIC_* names in EAS secrets for preview/production — see docs/kaan-launch-closure-execution-sheet.md § 4.",
  };

  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) {
    process.exitCode = 1;
  }
}

main();
