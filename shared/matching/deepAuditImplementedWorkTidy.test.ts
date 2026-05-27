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

const auditReport = read("docs/audits/deep-audit-implemented-work-2026-05-01.md");
const branchDelta = read("docs/branch-deltas/chore-deep-audit-implemented-work-tidy.md");
const activeDocMap = read("docs/active-doc-map.md");
const notificationDesign = read("docs/notification-system-design.md");
const nativeOneSignal = read("apps/mobile/lib/onesignal.ts");
const pushRegistration = read("apps/mobile/components/PushRegistration.tsx");
const notificationDeepLinkHandler = read("apps/mobile/components/NotificationDeepLinkHandler.tsx");
const authContext = read("apps/mobile/context/AuthContext.tsx");

test("obsolete contradictory docs and backups are removed", () => {
  for (const path of [
    "docs/notification-permission-audit.md",
    "docs/phase7-stage3-onesignal-daily-validation.md",
    "_cursor_context/vibely_rebuild_master_backup_chatgpt.md",
  ]) {
    assert.equal(exists(path), false, `${path} should remain removed`);
  }
});

test("audit report and branch delta capture the tidy scope", () => {
  assert.match(auditReport, /PASS with cleanup/);
  assert.match(auditReport, /No runtime code was changed/);
  assert.match(auditReport, /No cloud mutation or deploy performed/);
  assert.match(branchDelta, /Docs\/tests only/);
  assert.match(branchDelta, /No broad historical-doc purge/);
  assert.match(activeDocMap, /deep-audit-implemented-work-2026-05-01\.md/);
  assert.match(activeDocMap, /deepAuditImplementedWorkTidy\.test\.ts/);
});

test("current notification docs no longer repeat stale OneSignal/native push claims", () => {
  const docs = [
    "docs/notification-system-design.md",
    "docs/notification-pipeline-verification.md",
    "docs/web-push-production-checklist.md",
    "_cursor_context/vibely_onesignal_provider_sheet.md",
    "_cursor_context/vibely_rebuild_runbook.md",
  ].map(read).join("\n");

  assert.doesNotMatch(docs, /ONESIGNAL_APP_ID_FALLBACK/);
  assert.doesNotMatch(docs, /97e52ea2-6a27-4486-a678-4dd8a0d49e94/);
  assert.doesNotMatch(docs, /send-notification implementation absent/i);
  assert.doesNotMatch(docs, /NotificationDeepLinkHandler(?:\.tsx)?(?:`|\*\*)? is (?:not present|missing)/i);
  assert.doesNotMatch(docs, /hardcoded frontend app ID|hardcoded Vibely OneSignal app ID/i);
});

test("notification design doc matches current native push implementation", () => {
  assert.match(notificationDesign, /registerPushWithBackend\(user\.id\)` is now sync-only/);
  assert.match(notificationDesign, /syncNativePushDeliveryOnForeground/);
  assert.match(notificationDesign, /NotificationDeepLinkHandler/);
  assert.match(notificationDesign, /reconciles `\/date\/:id` against backend video-session truth/);
  assert.match(nativeOneSignal, /Register this device's push subscription with the backend when OS permission is already granted/);
  assert.match(nativeOneSignal, /getOsPushPermissionState\(\)\) !== 'granted'/);
  assert.match(pushRegistration, /bindOneSignalExternalUser\(user\.id\)/);
  assert.match(pushRegistration, /syncNativePushDeliveryOnForeground\(user\.id, reason\)/);
  assert.match(notificationDeepLinkHandler, /OneSignal\.Notifications\.addEventListener/);
  assert.match(notificationDeepLinkHandler, /reconcileHrefWithRegistration/);
  assert.match(authContext, /disconnectOneSignalForLogout\(uid\)/);
  assert.match(nativeOneSignal, /mobile_onesignal_player_id:\s*null/);
  assert.match(nativeOneSignal, /mobile_onesignal_subscribed:\s*false/);
});

test("provider readiness and closure artifacts remain present", () => {
  for (const path of [
    "docs/investigations/streams-1-3-backend-ready-gate-authority.md",
    "docs/investigations/streams-4-6-ready-gate-client-parity.md",
    "docs/investigations/streams-7-8-event-loop-reliability.md",
    "docs/investigations/payment-email-phone-trust-systems.md",
    "docs/investigations/push-media-daily-provider-readiness.md",
    "docs/branch-deltas/fix-push-media-daily-provider-readiness-closure.md",
    "shared/matching/pushMediaDailyProviderReadinessClosure.test.ts",
    "shared/matching/onesignalProviderOperationalQa.test.ts",
    "shared/matching/bunnyProviderOperationalQa.test.ts",
    "shared/matching/dailyProviderOperationalQa.test.ts",
  ]) {
    assert.equal(exists(path), true, `${path} should exist`);
  }
});

test("tidy pass adds no backend/cloud/native artifacts", () => {
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => name.includes("deep_audit_implemented_work")),
    false,
  );
  assert.equal(exists("supabase/validation/deep_audit_implemented_work.sql"), false);
  assert.doesNotMatch(branchDelta, /Edge Function deploy requirement:\s*(?!none)/i);
  assert.match(branchDelta, /Supabase migration requirement: none/);
  assert.match(branchDelta, /Env vars added\/changed: none/);
  assert.match(branchDelta, /Native module changes: none/);
  assert.match(branchDelta, /`expo-av`: not used/);
  assert.doesNotMatch(read("apps/mobile/package.json"), /"expo-av"\s*:/);

  const nativeCodeFiles = readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]));
  for (const path of nativeCodeFiles) {
    assert.doesNotMatch(
      read(path),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
});
