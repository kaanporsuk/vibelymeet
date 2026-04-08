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
  "docs/phase7-stage5-release-readiness-and-go-nogo.md",
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function main() {
  const errors = [];
  const warnings = [];
  const info = [];

  const appJsonPath = join(MOBILE, "app.json");
  if (!existsSync(appJsonPath)) {
    errors.push(`Missing ${appJsonPath}`);
  } else {
    const app = readJson(appJsonPath);
    const iosId = app?.expo?.ios?.bundleIdentifier;
    const androidPkg = app?.expo?.android?.package;
    const scheme = app?.expo?.scheme;
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
    const aps = app?.expo?.ios?.entitlements?.["aps-environment"];
    if (aps === "development") {
      info.push(
        "app.json entitlements aps-environment is development; EAS preview/production builds still use OneSignal production APNs via app.config.js — confirm with docs/kaan-launch-closure-execution-sheet.md § OneSignal.",
      );
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
