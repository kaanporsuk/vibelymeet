import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
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

const investigationReport = read("docs/investigations/push-media-daily-provider-readiness.md");
const branchDelta = read("docs/branch-deltas/fix-push-media-daily-provider-readiness-closure.md");
const oneSignalSheet = read("_cursor_context/vibely_onesignal_provider_sheet.md");
const rebuildRunbook = read("_cursor_context/vibely_rebuild_runbook.md");
const webOneSignal = read("src/lib/onesignal.ts");
const bunnyQa = read("shared/matching/bunnyProviderOperationalQa.test.ts");
const uploadChatVideo = read("supabase/functions/upload-chat-video/index.ts");

test("closure keeps the investigation report and branch delta linked", () => {
  assert.ok(existsSync(join(root, "docs/investigations/push-media-daily-provider-readiness.md")));
  assert.match(investigationReport, /Executive Verdict[\s\S]{0,80}WARN/);
  assert.match(branchDelta, /Investigation report: `docs\/investigations\/push-media-daily-provider-readiness\.md`/);
  assert.match(branchDelta, /WARN-OS-DOC-DRIFT/);
  assert.match(branchDelta, /WARN-BUNNY-CHAT-OWNERSHIP/);
});

test("OneSignal operator docs match the env-only runtime contract", () => {
  for (const source of [oneSignalSheet, rebuildRunbook]) {
    assert.match(source, /VITE_ONESIGNAL_APP_ID/);
    assert.match(source, /web push initialization is (?:skipped|disabled)|OneSignal is disabled when its app ID is unset/);
    assert.doesNotMatch(source, /ONESIGNAL_APP_ID_FALLBACK/);
    assert.doesNotMatch(source, /97e52ea2-6a27-4486-a678-4dd8a0d49e94/);
    assert.doesNotMatch(source, /hardcoded frontend app ID|hardcoded Vibely OneSignal app ID/i);
    assert.doesNotMatch(source, /OneSignal App ID is now \*\*env-backed with fallback\*\*/);
    assert.doesNotMatch(source, /historical App ID is used/);
  }

  assert.match(webOneSignal, /import\.meta\.env\.VITE_ONESIGNAL_APP_ID/);
  assert.match(webOneSignal, /VITE_ONESIGNAL_APP_ID not set, push disabled/);
  assert.doesNotMatch(webOneSignal, /ONESIGNAL_APP_ID_FALLBACK|appId:\s*["'][0-9a-f]{8}-[0-9a-f-]{20,}["']/i);
});

test("Bunny chat-video ownership warning remains deferred instead of changing product semantics", () => {
  assert.match(branchDelta, /Deferred.*WARN-BUNNY-CHAT-OWNERSHIP/s);
  assert.match(branchDelta, /product\/provider ownership confirmation/);
  assert.match(bunnyQa, /chat video Bunny\/Supabase ownership is explicit for the current baseline/);
  assert.match(uploadChatVideo, /const storagePath = `chat-videos\/\$\{matchId\.trim\(\)\}\/\$\{user\.id\}_\$\{timestamp\}\.\$\{ext\}`/);
  assert.match(uploadChatVideo, /upload_provider:\s*"bunny"/);
});

test("closure stays docs/test-only with no provider cloud artifacts or native-module drift", () => {
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) =>
      name.includes("push_media_daily_provider_readiness_closure")
    ),
    false,
    "closure should not add a Supabase migration",
  );
  assert.equal(
    existsSync(join(root, "supabase/validation/push_media_daily_provider_readiness_closure.sql")),
    false,
    "closure should not add validation SQL because no migration is expected",
  );
  assert.match(branchDelta, /Supabase migration requirement: none/);
  assert.match(branchDelta, /Edge Function deploy requirement: none/);
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

test("provider stream artifacts remain present", () => {
  assert.match(read("shared/matching/onesignalProviderOperationalQa.test.ts"), /web OneSignal initialization is env-backed/);
  assert.match(read("docs/branch-deltas/fix-onesignal-provider-operational-qa.md"), /OneSignal Provider Operational QA/);
  assert.match(read("shared/matching/bunnyProviderOperationalQa.test.ts"), /create-video-upload reads required Bunny Stream env names/);
  assert.match(read("docs/branch-deltas/fix-bunny-provider-operational-qa.md"), /Bunny Provider Operational QA/);
  assert.match(read("shared/matching/dailyProviderOperationalQa.test.ts"), /daily-room reads required Daily env names/);
  assert.match(read("docs/branch-deltas/fix-daily-provider-operational-qa.md"), /Daily Provider Operational QA/);
});
