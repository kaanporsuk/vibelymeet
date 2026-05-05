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

function assertOrder(source: string, labels: Array<[string, string]>): void {
  let last = -1;
  for (const [label, needle] of labels) {
    const index = source.indexOf(needle, last + 1);
    assert.ok(index >= 0, `${label} marker should exist`);
    assert.ok(index > last, `${label} should appear after the previous marker`);
    last = index;
  }
}

const createVideoUpload = read("supabase/functions/create-video-upload/index.ts");
const videoWebhook = read("supabase/functions/video-webhook/index.ts");
const deleteVibeVideo = read("supabase/functions/delete-vibe-video/index.ts");
const uploadImage = read("supabase/functions/upload-image/index.ts");
const uploadEventCover = read("supabase/functions/upload-event-cover/index.ts");
const uploadVoice = read("supabase/functions/upload-voice/index.ts");
const uploadChatVideo = read("supabase/functions/upload-chat-video/index.ts");
const processMediaDeleteJobs = read("supabase/functions/process-media-delete-jobs/index.ts");
const bunnyMedia = read("supabase/functions/_shared/bunny-media.ts");
const webImageUrl = read("src/utils/imageUrl.ts");
const nativeImageUrl = read("apps/mobile/lib/imageUrl.ts");
const webVibeState = read("src/lib/vibeVideo/webVibeVideoState.ts");
const webHeroController = read("src/lib/heroVideo/heroVideoUploadController.ts");
const nativeVibeApi = read("apps/mobile/lib/vibeVideoApi.ts");
const nativeVibeState = read("apps/mobile/lib/vibeVideoState.ts");
const nativeVibePlaybackUrl = read("apps/mobile/lib/vibeVideoPlaybackUrl.ts");
const nativePackageJson = read("apps/mobile/package.json");
const supabaseConfig = read("supabase/config.toml");
const providerSheet = read("_cursor_context/vibely_bunny_provider_sheet.md");
const branchDelta = read("docs/branch-deltas/fix-bunny-provider-operational-qa.md");

test("create-video-upload reads required Bunny Stream env names", () => {
  for (const name of [
    "BUNNY_STREAM_LIBRARY_ID",
    "BUNNY_STREAM_API_KEY",
    "BUNNY_STREAM_CDN_HOSTNAME",
  ]) {
    assert.match(createVideoUpload, new RegExp(`Deno\\.env\\.get\\(["']${name}["']\\)`));
  }
  assert.doesNotMatch(createVideoUpload, /BUNNY_STORAGE_(?:ZONE|API_KEY)/);
});

test("create-video-upload creates Bunny Stream object before returning TUS credentials", () => {
  assertOrder(createVideoUpload, [
    ["Bunny Stream create", "https://video.bunnycdn.com/library/${libraryId}/videos"],
    ["TUS signature input", "const signatureInput = `${libraryId}${apiKey}${expirationTime}${videoId}`"],
    ["media session create", "\"create_media_session\""],
    ["profile activation", "\"activate_profile_vibe_video\""],
    ["successful credentials response", "repairableLifecycleState: sessionStatus !== \"uploading\""],
  ]);
});

test("TUS upload endpoint remains Bunny Stream tusupload on web and native", () => {
  assert.match(webHeroController, /endpoint:\s*["']https:\/\/video\.bunnycdn\.com\/tusupload["']/);
  assert.match(nativeVibeApi, /endpoint:\s*['"]https:\/\/video\.bunnycdn\.com\/tusupload['"]/);
});

test("create-video-upload writes bunny video uid and uploading status through the profile lifecycle RPC", () => {
  assert.match(createVideoUpload, /"activate_profile_vibe_video"/);
  assert.match(createVideoUpload, /p_video_id:\s*videoId/);
  assert.match(createVideoUpload, /p_video_status:\s*"uploading"/);
  assert.match(createVideoUpload, /update_media_session_status/);
});

test("video-webhook maps Bunny status to ready, failed, or processing", () => {
  assert.match(videoWebhook, /let mappedStatus = "processing"/);
  assert.match(videoWebhook, /if \(Status === 3\) mappedStatus = "ready"/);
  assert.match(videoWebhook, /if \(Status === 4\) mappedStatus = "ready"/);
  assert.match(videoWebhook, /if \(Status === 5\) mappedStatus = "failed"/);
});

test("video-webhook updates active media session or legacy profile by Bunny video UID", () => {
  assert.match(videoWebhook, /"update_media_session_status"/);
  assert.match(videoWebhook, /p_provider_id:\s*VideoGuid/);
  assert.match(videoWebhook, /\.from\("profiles"\)[\s\S]{0,160}\.update\(\{ bunny_video_status: mappedStatus \}\)[\s\S]{0,120}\.eq\("bunny_video_uid", VideoGuid\)/);
  assert.match(videoWebhook, /BUNNY_VIDEO_WEBHOOK_TOKEN/);
  assert.match(videoWebhook, /verifyBunnyStreamWebhookSignature/);
  assert.match(supabaseConfig, /\[functions\.video-webhook\][\s\S]{0,80}verify_jwt = false/);
});

test("delete-vibe-video clears local profile state and hands remote deletion to the Bunny delete worker", () => {
  assert.match(deleteVibeVideo, /"clear_profile_vibe_video"/);
  assert.match(deleteVibeVideo, /p_clear_caption:\s*true/);
  assert.match(deleteVibeVideo, /deleteDeferredToWorker:\s*true/);
  assert.match(deleteVibeVideo, /possibleBunnyOrphan:\s*true/);
  assert.match(processMediaDeleteJobs, /deleteMediaAsset/);
  assert.match(bunnyMedia, /deleteBunnyStreamVideo/);
  assert.match(bunnyMedia, /DELETE https:\/\/video\.bunnycdn\.com\/library\/\{libraryId\}\/videos\/\{videoId\}/);
});

test("upload-image uses Bunny Storage and the photos path convention", () => {
  assert.match(uploadImage, /BUNNY_STORAGE_ZONE/);
  assert.match(uploadImage, /BUNNY_STORAGE_API_KEY/);
  assert.match(uploadImage, /https:\/\/\$\{storageHostname\}\/\$\{storageZone\}\/\$\{storagePath\}/);
  assert.match(uploadImage, /const storagePath = `photos\/\$\{user\.id\}\/\$\{uniqueId\}\.\$\{ext\}`/);
  assert.match(uploadImage, /MEDIA_FAMILIES\.PROFILE_PHOTO/);
});

test("upload-event-cover uses Bunny Storage and the events path convention", () => {
  assert.match(uploadEventCover, /\.from\("user_roles"\)[\s\S]{0,160}\.eq\("role", "admin"\)/);
  assert.match(uploadEventCover, /BUNNY_STORAGE_ZONE/);
  assert.match(uploadEventCover, /BUNNY_STORAGE_API_KEY/);
  assert.match(uploadEventCover, /https:\/\/storage\.bunnycdn\.com\/\$\{storageZone\}\/\$\{storagePath\}/);
  assert.match(uploadEventCover, /const folder = eventId \? `events\/\$\{eventId\}` : `events\/covers`/);
  assert.match(uploadEventCover, /const coverUrl = `https:\/\/\$\{cdnHostname\}\/\$\{storagePath\}`/);
});

test("upload-voice uses Bunny Storage and the voice path convention", () => {
  assert.match(uploadVoice, /conversation_id is required/);
  assert.match(uploadVoice, /BUNNY_STORAGE_ZONE/);
  assert.match(uploadVoice, /BUNNY_STORAGE_API_KEY/);
  assert.match(uploadVoice, /https:\/\/storage\.bunnycdn\.com\/\$\{storageZone\}\/\$\{storagePath\}/);
  assert.match(uploadVoice, /const folder = `voice\/\$\{conversationId\.trim\(\)\}`/);
  assert.match(uploadVoice, /const audioUrl = bunnyCdnUrl\(storagePath\)/);
});

test("URL resolvers support Bunny photos paths and preserve legacy/Supabase paths", () => {
  for (const source of [webImageUrl, nativeImageUrl]) {
    assert.match(source, /p\.startsWith\(["']photos\/["']\)/);
    assert.match(source, /BUNNY_CDN/);
    assert.match(source, /storage\/v1\/object\/public/);
    assert.match(source, /supabase\.co/);
    assert.match(source, /p\.startsWith\(["']http:\/\/["']\)/);
    assert.match(source, /p\.startsWith\(["']https:\/\/["']\)/);
  }
});

test("Vibe Video playback URL uses Bunny Stream CDN and playlist.m3u8", () => {
  assert.match(webVibeState, /VITE_BUNNY_STREAM_CDN_HOSTNAME/);
  assert.match(webVibeState, /`https:\/\/\$\{hostname\}\/\$\{uid\}\/playlist\.m3u8`/);
  assert.match(webVibeState, /`https:\/\/\$\{hostname\}\/\$\{uid\}\/thumbnail\.jpg`/);
  assert.match(nativeVibePlaybackUrl, /EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME/);
  assert.match(nativeVibePlaybackUrl, /`https:\/\/\$\{hostname\}\/\$\{uid\}\/playlist\.m3u8`/);
  assert.match(nativeVibePlaybackUrl, /`https:\/\/\$\{hostname\}\/\$\{uid\}\/thumbnail\.jpg`/);
});

test("native Vibe Video resolver remains canonical and no expo-av import or package exists", () => {
  assert.match(nativeVibeState, /resolveCanonicalVibeVideoState/);
  assert.match(nativeVibeState, /canPlay:\s*!!playbackUrl/);
  assert.match(nativeVibeState, /isScoreEligible:\s*true/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);

  const nativeCodeFiles = readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]));
  for (const path of nativeCodeFiles) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
});

test("chat video Bunny/Supabase ownership is explicit for the current baseline", () => {
  assert.match(uploadChatVideo, /const storagePath = `chat-videos\/\$\{matchId\.trim\(\)\}\/\$\{user\.id\}_\$\{timestamp\}\.\$\{ext\}`/);
  assert.match(uploadChatVideo, /https:\/\/storage\.bunnycdn\.com\/\$\{storageZone\}\/\$\{storagePath\}/);
  assert.match(uploadChatVideo, /const videoUrl = bunnyCdnUrl\(storagePath\)/);
  assert.match(uploadChatVideo, /upload_provider:\s*"bunny"/);
  assert.match(providerSheet, /path prefix\*\* `chat-videos\/` on Bunny with a Supabase Storage bucket/);
});

test("no new Bunny env vars, native modules, or Supabase migration were added for Stream 12", () => {
  const envSource = [
    createVideoUpload,
    videoWebhook,
    deleteVibeVideo,
    uploadImage,
    uploadEventCover,
    uploadVoice,
    uploadChatVideo,
    bunnyMedia,
    webImageUrl,
    webVibeState,
    nativeImageUrl,
    nativeVibePlaybackUrl,
    nativeVibeApi,
  ].join("\n");
  const bunnyEnvNames = Array.from(
    new Set(
      [...envSource.matchAll(/(?:Deno\.env\.get\(["']|optionalEnv\(["']|import\.meta\.env\??\.|process\.env\.)([A-Z0-9_]+)/g)]
        .map((match) => match[1])
        .filter((name) => name.includes("BUNNY")),
    ),
  ).sort();

  assert.deepEqual(bunnyEnvNames, [
    "BUNNY_CDN_HOSTNAME",
    "BUNNY_CDN_PATH_PREFIX",
    "BUNNY_STORAGE_API_KEY",
    "BUNNY_STORAGE_ZONE",
    "BUNNY_STREAM_API_KEY",
    "BUNNY_STREAM_CDN_HOSTNAME",
    "BUNNY_STREAM_LIBRARY_ID",
    "BUNNY_VIDEO_WEBHOOK_TOKEN",
    "BUNNY_WEBHOOK_SIGNING_KEY",
    "EXPO_PUBLIC_BUNNY_CDN_HOSTNAME",
    "EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX",
    "EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME",
    "VITE_BUNNY_CDN_HOSTNAME",
    "VITE_BUNNY_CDN_PATH_PREFIX",
    "VITE_BUNNY_STREAM_CDN_HOSTNAME",
  ]);
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => name.includes("bunny_provider_operational_qa")),
    false,
  );
  assert.match(branchDelta, /Env var changes: none/);
  assert.match(branchDelta, /Native module changes: none/);
  assert.match(branchDelta, /Supabase migration requirement: none/);
});

test("Bunny operational QA docs capture safe production checks and deferred smoke tests", () => {
  assert.match(branchDelta, /cdn\.vibelymeet\.com\/` returned HTTP 404 from BunnyCDN root/);
  assert.match(branchDelta, /vz-5585ddfc-604\.b-cdn\.net\/` returned HTTP 404 from BunnyCDN root/);
  assert.match(branchDelta, /No real production media smoke was run/);
  assert.match(branchDelta, /Manual Bunny Provider-Dashboard Checklist/);
  assert.match(branchDelta, /controlled internal Vibe Video upload\/playback QA/);
});

test("Streams 1-11 artifacts remain present", () => {
  assert.match(read("supabase/migrations/20260501180000_event_lobby_active_event_contract.sql"), /get_event_lobby_inactive_reason/);
  assert.match(read("supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql"), /GET DIAGNOSTICS v_row_count = ROW_COUNT/);
  assert.match(read("supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql"), /terminalize_event_ready_gates/);
  assert.match(read("docs/ready-gate-backend-contract.md"), /Ready Gate Backend Contract/);
  assert.match(read("shared/matching/readyGateTerminalRecovery.ts"), /resolveReadyGateTerminalRecovery/);
  assert.match(read("shared/matching/nativeReadyGateParityContract.test.ts"), /native Ready Gate API uses canonical ready_gate_transition actions/);
  assert.match(read("supabase/migrations/20260501210000_swipe_retry_idempotency_notification_dedupe.sql"), /handle_swipe_idempotency/);
  assert.match(read("shared/matching/realtimeSubscriptionTightening.test.ts"), /broad event-level video_sessions/);
  assert.match(read("supabase/migrations/20260501220000_premium_credits_observability.sql"), /stripe_webhook_events/);
  assert.match(read("shared/matching/nativeVideoDateContractRecovery.test.ts"), /native date route exists/);
  assert.match(read("shared/matching/onesignalProviderOperationalQa.test.ts"), /web OneSignal initialization is env-backed/);
});

test("Stream 12 expected files exist", () => {
  assert.ok(existsSync(join(root, "docs/branch-deltas/fix-bunny-provider-operational-qa.md")));
  assert.ok(existsSync(join(root, "shared/matching/bunnyProviderOperationalQa.test.ts")));
});
