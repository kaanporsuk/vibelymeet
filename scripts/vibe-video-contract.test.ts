import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  hasAnyBunnyStreamSignatureHeader,
  verifyBunnyStreamWebhookSignature,
} from "../supabase/functions/_shared/bunny-stream-webhook";
import {
  __setHlsLoaderForTest,
  attachHlsPlayback,
} from "../src/lib/vibeVideo/attachHlsPlayback";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function readTreeFiles(dir: string, extensions: ReadonlySet<string>, ignored = new Set(["node_modules", ".expo"])): string[] {
  const abs = join(root, dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    if (ignored.has(entry)) continue;
    const path = join(abs, entry);
    const rel = `${dir}/${entry}`;
    const st = statSync(path);
    if (st.isDirectory()) {
      out.push(...readTreeFiles(rel, extensions, ignored));
    } else if (extensions.has(entry.slice(entry.lastIndexOf(".")))) {
      out.push(rel);
    }
  }
  return out;
}

test("inline VibePlayer uses the unified media asset playback hook", () => {
  const player = read("src/components/vibe-video/VibePlayer.tsx");
  const hook = read("src/hooks/useMediaAsset.ts");
  const attach = read("src/lib/vibeVideo/attachHlsPlayback.ts");

  assert.match(player, /useMediaAssetPlayback/);
  assert.match(hook, /attachHlsPlayback/);
  assert.doesNotMatch(player, /src=\{shouldLoad \? videoUrl : undefined\}/);
  assert.match(attach, /import\("hls\.js"\)/);
  assert.match(attach, /Hls\.isSupported\(\)/);
  assert.match(attach, /application\/vnd\.apple\.mpegurl/);
});

class FakeVideoElement {
  src = "";
  playCount = 0;
  pauseCount = 0;
  loadCount = 0;
  removedSrc = false;
  canPlayTypeValue = "";
  playError: unknown = null;
  listeners = new Map<string, Set<() => void>>();

  canPlayType(): string {
    return this.canPlayTypeValue;
  }

  play(): Promise<void> {
    this.playCount++;
    if (this.playError) return Promise.reject(this.playError);
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCount++;
  }

  load(): void {
    this.loadCount++;
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.src = "";
      this.removedSrc = true;
    }
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class FakeHls {
  static supported = true;
  static instances: FakeHls[] = [];
  static Events = {
    MANIFEST_PARSED: "manifestParsed",
    ERROR: "error",
  };

  source: string | null = null;
  media: unknown = null;
  config: Record<string, unknown> | undefined;
  destroyed = false;
  handlers = new Map<string, (event: unknown, data?: { fatal?: boolean; type?: string }) => void>();

  static isSupported(): boolean {
    return FakeHls.supported;
  }

  constructor(config?: Record<string, unknown>) {
    this.config = config;
    FakeHls.instances.push(this);
  }

  loadSource(source: string): void {
    this.source = source;
  }

  attachMedia(media: unknown): void {
    this.media = media;
  }

  on(event: string, handler: (event: unknown, data?: { fatal?: boolean; type?: string }) => void): void {
    this.handlers.set(event, handler);
  }

  emit(event: string, data?: { fatal?: boolean; type?: string }): void {
    this.handlers.get(event)?.(event, data);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

function resetFakeHls(): void {
  FakeHls.supported = true;
  FakeHls.instances = [];
  __setHlsLoaderForTest(async () => ({
    default: FakeHls as unknown as typeof import("hls.js").default,
  }));
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("attachHlsPlayback uses Safari native-HLS path and cleanup", () => {
  __setHlsLoaderForTest(null);
  const video = new FakeVideoElement();
  video.canPlayTypeValue = "probably";

  const cleanup = attachHlsPlayback(video as unknown as HTMLVideoElement, "https://cdn.example/video/playlist.m3u8");

  assert.equal(video.src, "https://cdn.example/video/playlist.m3u8");
  assert.equal(video.loadCount, 1);
  assert.equal(video.playCount, 1);

  cleanup();

  assert.equal(video.pauseCount, 1);
  assert.equal(video.loadCount, 2);
  assert.equal(video.removedSrc, true);
});

test("attachHlsPlayback uses hls.js on Chrome-capable browsers and destroys cleanly", async () => {
  resetFakeHls();
  const video = new FakeVideoElement();
  let manifestParsed = false;

  const cleanup = attachHlsPlayback(video as unknown as HTMLVideoElement, "https://cdn.example/video/playlist.m3u8", {
    onManifestParsed: () => {
      manifestParsed = true;
    },
  });
  await flushPromises();

  assert.equal(FakeHls.instances.length, 1);
  assert.deepEqual(FakeHls.instances[0].config, {
    fragLoadingMaxRetry: 1,
    levelLoadingMaxRetry: 1,
    manifestLoadingMaxRetry: 1,
  });
  assert.equal(FakeHls.instances[0].source, "https://cdn.example/video/playlist.m3u8");
  assert.equal(FakeHls.instances[0].media, video);

  FakeHls.instances[0].emit(FakeHls.Events.MANIFEST_PARSED);
  assert.equal(manifestParsed, true);
  assert.equal(video.playCount, 1);

  cleanup();
  assert.equal(FakeHls.instances[0].destroyed, true);
  assert.equal(video.pauseCount, 1);
  __setHlsLoaderForTest(null);
});

test("attachHlsPlayback reports unsupported and only the first playback error", async () => {
  resetFakeHls();
  const unsupportedVideo = new FakeVideoElement();
  const errors: string[] = [];
  FakeHls.supported = false;

  attachHlsPlayback(unsupportedVideo as unknown as HTMLVideoElement, "https://cdn.example/video/playlist.m3u8", {
    onError: (kind) => errors.push(kind),
  });
  await flushPromises();
  assert.deepEqual(errors, ["unsupported"]);

  resetFakeHls();
  const fatalVideo = new FakeVideoElement();
  attachHlsPlayback(fatalVideo as unknown as HTMLVideoElement, "https://cdn.example/video/playlist.m3u8", {
    onError: (kind) => errors.push(kind),
  });
  await flushPromises();
  FakeHls.instances[0].emit(FakeHls.Events.ERROR, { fatal: true, type: "networkError" });
  assert.equal(errors.at(-1), "fatal");

  fatalVideo.dispatch("error");
  assert.equal(errors.at(-1), "fatal");
  __setHlsLoaderForTest(null);
});

test("attachHlsPlayback reports autoplay blocking separately from fatal media errors", async () => {
  resetFakeHls();
  const video = new FakeVideoElement();
  video.playError = Object.assign(new Error("autoplay blocked"), { name: "NotAllowedError" });
  const errors: string[] = [];
  const autoplayBlocks: unknown[] = [];

  attachHlsPlayback(video as unknown as HTMLVideoElement, "https://cdn.example/video/playlist.m3u8", {
    onAutoplayBlocked: (detail) => autoplayBlocks.push(detail),
    onError: (kind) => errors.push(kind),
  });
  await flushPromises();
  FakeHls.instances[0].emit(FakeHls.Events.MANIFEST_PARSED);
  await flushPromises();

  assert.equal(video.playCount, 1);
  assert.equal(autoplayBlocks.length, 1);
  assert.deepEqual(errors, []);

  FakeHls.instances[0].emit(FakeHls.Events.ERROR, { fatal: true, type: "networkError" });
  assert.deepEqual(errors, ["fatal"]);
  __setHlsLoaderForTest(null);
});

test("native onboarding no longer sends pending as a Vibe Video uid", () => {
  const record = read("apps/mobile/app/vibe-video-record.tsx");
  const onboarding = read("apps/mobile/app/(onboarding)/index.tsx");

  assert.doesNotMatch(record, /returnToOnboarding\(['"]pending['"]\)/);
  assert.match(onboarding, /normalizeBunnyVideoUid/);
});

test("web and native upload controllers expose an explicit stalled phase", () => {
  const web = read("src/lib/heroVideo/heroVideoUploadController.ts");
  const webState = read("src/lib/vibeVideo/webVibeVideoState.ts");
  const native = read("apps/mobile/lib/nativeHeroVideoUploadController.ts");
  const nativeState = read("apps/mobile/lib/vibeVideoState.ts");
  const nativePoll = read("apps/mobile/lib/vibeVideoPoll.ts");
  const sharedSemantics = read("shared/vibeVideoSemantics.ts");

  assert.match(web, /"stalled"/);
  assert.match(native, /'stalled'/);
  assert.match(web, /taking longer than expected/);
  assert.match(native, /taking longer than expected/);
  assert.match(sharedSemantics, /VIBE_VIDEO_STALE_PROCESSING_THRESHOLD_MS/);
  assert.match(sharedSemantics, /"stale_processing"/);
  assert.match(webState, /resolveCanonicalVibeVideoState/);
  assert.match(nativeState, /resolveCanonicalVibeVideoState/);
  assert.doesNotMatch(webState, /state: "uploading"/);
  assert.doesNotMatch(nativeState, /state: 'uploading'/);
  assert.match(nativeState, /state: 'ready'[\s\S]*canPlay: !!playbackUrl/);
  assert.match(nativeState, /state: 'failed'[\s\S]*canRecord: true/);
  assert.match(nativeState, /status is non-terminal[\s\S]*state: 'processing'/);
  assert.match(webState, /canonical\.state === "processing" \|\| canonical\.state === "stale_processing"/);
  assert.match(nativeState, /canonical\.state === 'processing' \|\| canonical\.state === 'stale_processing'/);
  assert.match(nativePoll, /profile_bunny_video_uid_cleared/);
  assert.match(nativePoll, /profile_bunny_video_uid_replaced/);
});

test("web stalled Vibe Video polling resumes once when the tab becomes visible", () => {
  const webController = read("src/lib/heroVideo/heroVideoUploadController.ts");
  const webTelemetry = read("src/lib/vibeVideo/vibeVideoTelemetry.ts");

  assert.match(webTelemetry, /vibe_video_poll_stalled_visible/);
  assert.match(webTelemetry, /vibe_video_visibility_resume_poll/);
  assert.match(webController, /let _visibilityChangeHandler: \(\(\) => void\) \| null = null/);
  assert.match(webController, /_visibilityListenerAttached \|\| _visibilityChangeHandler/);
  assert.match(webController, /_visibilityChangeHandler = _handleVisibilityChange/);
  assert.match(webController, /document\.addEventListener\("visibilitychange", _visibilityChangeHandler\)/);
  assert.match(webController, /document\.removeEventListener\("visibilitychange", _visibilityChangeHandler\)/);
  assert.match(webController, /_visibilityChangeHandler = null/);
  assert.match(webController, /_visibilityListenerAttached = false/);
  assert.match(webController, /_visibilityResumeInFlight = false/);
  assert.match(webController, /type HotImportMeta = ImportMeta/);
  assert.match(webController, /const hot = \(import\.meta as HotImportMeta\)\.hot/);
  assert.match(webController, /if \(hot\) \{[\s\S]*?hot\.dispose\(\(\) => \{[\s\S]*?_removeVisibilityListener\(\)/);
  assert.match(webController, /document\.visibilityState !== "visible"/);
  assert.match(webController, /_state\.phase !== "stalled" \|\| !_state\.videoId/);
  assert.match(webController, /_visibilityResumeInFlight \|\| _pollTimerId !== null/);
  assert.match(webController, /_visibilityResumeInFlight = true/);
  assert.match(webController, /VIBE_VIDEO_EVENTS\.pollStalledVisible/);
  assert.match(webController, /VIBE_VIDEO_EVENTS\.visibilityResumePoll/);
  assert.match(webController, /_activePollVideoId = videoId[\s\S]{0,80}_pollAttempts = 0[\s\S]{0,80}_lastPollStatus = null/);
  assert.match(webController, /void _pollTick\(videoId\)\.finally\(\(\) => \{[\s\S]*?_state\.phase === "stalled"[\s\S]*?_activePollVideoId = null[\s\S]*?_visibilityResumeInFlight = false/);
});

test("UID-only Vibe Score and onboarding UID preservation remain source-backed", () => {
  const migration = read("supabase/migrations/20260501101000_vibe_video_contract_hardening.sql");
  const repairMigration = read("supabase/migrations/20260501123000_vibe_video_backend_contract_repair.sql");
  const repairValidation = read("supabase/validation/vibe_video_backend_contract_repair.sql");
  const webIncomplete = read("src/lib/vibeScoreIncompleteActions.ts");
  const nativeIncomplete = read("apps/mobile/lib/vibeScoreIncompleteActions.ts");
  const webProfileService = read("src/services/profileService.ts");
  const nativeProfileApi = read("apps/mobile/lib/profileApi.ts");
  const webProfileStudio = read("src/pages/ProfileStudio.tsx");
  const nativeProfileStudio = read("apps/mobile/app/(tabs)/profile/ProfileStudio.tsx");
  const wizard = read("src/components/wizard/ProfileWizard.tsx");
  const profileToDb = webProfileService.slice(
    webProfileService.indexOf("export const profileToDb"),
    webProfileService.indexOf("// Fetch current user's profile"),
  );
  const nativeUpdateMyProfile = nativeProfileApi.slice(
    nativeProfileApi.indexOf("export async function updateMyProfile"),
    nativeProfileApi.indexOf("/** Sync `profile_vibes`"),
  );

  assert.match(migration, /bunny_video_uid IS NOT NULL/);
  assert.match(migration, /length\(trim\(v_profile\.bunny_video_uid\)\) > 0/);
  assert.doesNotMatch(migration, /bunny_video_status\s*=\s*'ready'/);
  assert.match(repairMigration, /bunny_video_uid IS NOT NULL/);
  assert.match(repairMigration, /length\(trim\(v_profile\.bunny_video_uid\)\) > 0/);
  assert.doesNotMatch(repairMigration, /bunny_video_status\s*=\s*'ready'/);
  assert.match(repairMigration, /FOR r IN[\s\S]*WHERE bunny_video_uid IS NOT NULL[\s\S]*vibe_score = \(v_result->>'score'\)::integer/);
  assert.match(repairValidation, /Score Uploading/);
  assert.match(repairValidation, /Score Processing/);
  assert.match(repairValidation, /Score Ready/);
  assert.match(repairValidation, /Score Failed/);
  assert.match(repairValidation, /delete_clears_uid_and_removes_video_score_credit/);
  assert.match(webIncomplete, /bunnyVideoUid\?\.trim\(\)/);
  assert.match(nativeIncomplete, /bunny_video_uid\?\.trim\(\)/);
  assert.doesNotMatch(profileToDb, /vibe_score|vibeScore|vibe_score_label|vibeScoreLabel/);
  assert.doesNotMatch(nativeUpdateMyProfile, /vibe_score|vibe_score_label/);
  assert.match(webProfileStudio, /Server-computed; read from profiles\.vibe_score/);
  assert.match(nativeProfileStudio, /Server `vibe_score`/);
  assert.match(wizard, /server-computed vibe score/);
});

test("create-video-upload requires durable media-session state before credentials are returned", () => {
  const edge = read("supabase/functions/create-video-upload/index.ts");
  const orphanMigration = read("supabase/migrations/20260501130000_vibe_video_upload_orphan_cleanup.sql");

  const attemptCreateIdx = edge.indexOf('cleanupFailurePath = "create_vibe_video_upload_attempt"');
  const sessionCreateIdx = edge.indexOf('"create_media_session"');
  const profileActivateIdx = edge.indexOf('"activate_profile_vibe_video"');
  assert.ok(attemptCreateIdx >= 0, "vibe_video_uploads idempotency reservation missing");
  assert.ok(sessionCreateIdx >= 0, "create_media_session call missing");
  assert.ok(profileActivateIdx >= 0, "activate_profile_vibe_video call missing");
  assert.ok(
    attemptCreateIdx < sessionCreateIdx,
    "upload attempt must be reserved before durable session/profile writes",
  );
  assert.ok(
    sessionCreateIdx < profileActivateIdx,
    "media session must be durable before profile UID activation",
  );

  assert.match(edge, /media_session_create_failed/);
  assert.match(edge, /enqueue_vibe_video_orphan_delete/);
  assert.match(edge, /create_video_upload_durable_orphan_cleanup_enqueued/);
  assert.match(edge, /failure_path: "create_media_session_error"/);
  assert.match(edge, /failure_path: "create_media_session_rejected"/);
  assert.match(edge, /failure_path: "activate_profile_vibe_video_error"/);
  assert.match(edge, /failure_path: "activate_profile_vibe_video_rejected"/);
  assert.match(edge, /attemptCreateError\?\.code === "23505"/);
  assert.match(edge, /create_video_upload_attempt_reused_after_duplicate/);
  assert.match(edge, /isReusableVibeVideoUploadAttemptStatus/);
  assert.match(edge, /create_video_upload_attempt_terminal_reuse_rejected/);
  assert.match(edge, /create_video_upload_attempt_reuse_waiting_for_durable_link/);
  assert.match(edge, /REUSABLE_ATTEMPT_LINK_WAIT_DELAYS_MS/);
  assert.match(edge, /isDurablyLinkedUploadAttempt/);
  assert.match(edge, /waitForDurableReusableUploadAttempt/);
  assert.match(edge, /has_media_session/);
  assert.match(edge, /has_media_asset/);
  assert.match(edge, /profile_linked/);
  assert.match(edge, /create_video_upload_attempt_session_link_failed/);
  assert.match(edge, /create_video_upload_attempt_asset_link_failed_but_repairable/);
  assert.match(edge, /bunny_create_invalid_response/);
  assert.match(edge, /markVibeVideoUploadAttemptFailed/);
  assert.ok(
    edge.indexOf("enqueueDurableOrphanCleanup") < edge.indexOf('method: "DELETE"'),
    "durable orphan cleanup must be enqueued before best-effort Bunny DELETE",
  );
  assert.match(edge, /create_video_upload_media_session_create_rejected/);
  assert.match(edge, /create_video_upload_media_session_uploading_mark_failed_but_repairable/);
  assert.match(edge, /repairableLifecycleState/);
  assert.match(edge, /uploadCredentialsReturned = true/);
  assert.match(edge, /createdVideoId &&[\s\S]*?!uploadCredentialsReturned[\s\S]*?cleanupCreatedVideo/);
  assert.match(edge, /if \(sessionError\) \{[\s\S]*?media_session_create_failed[\s\S]*?return json/);

  assert.match(orphanMigration, /CREATE OR REPLACE FUNCTION public\.enqueue_vibe_video_orphan_delete/);
  assert.match(orphanMigration, /SECURITY DEFINER/);
  assert.match(orphanMigration, /is_valid_bunny_video_uid/);
  assert.match(orphanMigration, /pg_advisory_xact_lock/);
  assert.match(orphanMigration, /ensure_vibe_video_asset/);
  assert.match(orphanMigration, /media_references[\s\S]*is_active = true/);
  assert.match(orphanMigration, /active_reference_exists/);
  assert.match(orphanMigration, /status = 'purge_ready'/);
  assert.match(orphanMigration, /enqueue_media_delete\(v_asset_id, 'orphan_sweep'\)/);
  assert.match(orphanMigration, /REVOKE ALL ON FUNCTION public\.enqueue_vibe_video_orphan_delete/);
  assert.match(orphanMigration, /GRANT EXECUTE ON FUNCTION public\.enqueue_vibe_video_orphan_delete[\s\S]*TO service_role/);
});

test("create-video-upload keeps durable orphan cleanup as source of truth when immediate Bunny DELETE fails", () => {
  const edge = read("supabase/functions/create-video-upload/index.ts");
  const cleanupStart = edge.indexOf("async function cleanupCreatedVideo");
  const serveStart = edge.indexOf("serve(async", cleanupStart);
  const cleanupFunction = edge.slice(cleanupStart, serveStart);
  const durableAttemptIdx = cleanupFunction.indexOf("const durableCleanup = await enqueueDurableOrphanCleanup");
  const immediateDeleteIdx = cleanupFunction.indexOf("const deleteResponse = await fetch");
  const immediateDeleteFailureIdx = cleanupFunction.indexOf("create_video_upload_cleanup_failed", immediateDeleteIdx);
  const cleanupContextBlocks = edge.match(/context: \{[\s\S]*?\},/g)?.join("\n") ?? "";

  assert.ok(cleanupStart >= 0, "cleanupCreatedVideo helper missing");
  assert.ok(durableAttemptIdx >= 0, "durable orphan cleanup attempt missing");
  assert.ok(immediateDeleteIdx >= 0, "best-effort Bunny DELETE missing");
  assert.ok(
    durableAttemptIdx < immediateDeleteIdx,
    "durable orphan cleanup must be attempted before immediate Bunny DELETE",
  );
  assert.match(edge, /createdVideoId = videoId/);
  assert.match(edge, /createdVideoId &&[\s\S]*?!uploadCredentialsReturned[\s\S]*?cleanupCreatedVideo/);
  assert.match(cleanupFunction, /durableCleanup\?\.skipped === true[\s\S]*?return;/);
  assert.match(cleanupFunction, /durableCleanup\?\.success !== true && requireDurableBeforeImmediate[\s\S]*?return;/);
  assert.match(cleanupFunction, /bunny_status: deleteResponse\.status/);
  assert.doesNotMatch(cleanupFunction, /deleteResponse\.ok/);
  assert.ok(
    immediateDeleteFailureIdx > immediateDeleteIdx,
    "immediate DELETE failure must be logged after durable cleanup has already been attempted",
  );
  assert.doesNotMatch(cleanupFunction.slice(immediateDeleteFailureIdx), /\bthrow\b|return json/);
  assert.doesNotMatch(cleanupContextBlocks, /signature|expirationTime|cdnHostname|libraryId|apiKey|AccessKey/);
});

test("stale Vibe Video repair classifies stuck states without deleting provider media", () => {
  const migration = read("supabase/migrations/20260501123000_vibe_video_backend_contract_repair.sql");
  const validation = read("supabase/validation/vibe_video_backend_contract_repair.sql");

  assert.match(migration, /classify_stale_vibe_video_uploads/);
  assert.match(migration, /mark_stale_vibe_video_uploads_failed/);
  assert.match(migration, /profile_processing_without_active_session/);
  assert.match(migration, /session_uploading_stale/);
  assert.match(migration, /session_processing_stale/);
  assert.match(migration, /dms\.status IN \('created', 'uploading', 'processing'\)/);
  assert.match(migration, /SET bunny_video_status = 'failed'/);
  assert.match(migration, /btrim\(p\.bunny_video_uid\) = c\.provider_id/);
  assert.match(migration, /preserves bunny_video_uid for score\/history/);
  assert.doesNotMatch(migration, /deleteBunnyStreamVideo|DELETE https:\/\/video\.bunnycdn\.com|clear_profile_vibe_video/);

  assert.match(validation, /stale_classifier_finds_only_stale_current_profile_uids/);
  assert.match(validation, /stale_repair_marks_stale_failed_preserves_uid_and_skips_fresh/);
  assert.match(validation, /v_fresh_status = 'processing'/);
  assert.match(validation, /v_stale_uploading_score = v_baseline_score \+ 15/);
  assert.match(validation, /v_stale_processing_score = v_baseline_score \+ 15/);
});

test("backend-owned Vibe Video field guardrails and validation SQL are present", () => {
  const migration = read("supabase/migrations/20260501120000_vibe_video_backend_owned_field_guardrails.sql");
  const validation = read("supabase/validation/vibe_video_final_hardening.sql");

  assert.match(migration, /protect_backend_owned_vibe_video_profile_fields/);
  assert.match(migration, /BEFORE UPDATE OF bunny_video_uid, bunny_video_status, vibe_video_status/);
  assert.match(migration, /current_setting\('role', true\) = 'service_role'/);
  assert.match(migration, /current_user IN \('postgres', 'supabase_admin'\)/);
  assert.match(migration, /vibely\.vibe_video_server_update/);
  assert.match(validation, /authenticated_user_cannot_write_bunny_video_uid/);
  assert.match(validation, /authenticated_user_can_update_vibe_caption/);
  assert.match(validation, /old_webhook_status_cannot_mutate_replaced_profile_uid/);
  assert.match(validation, /cleared_video_webhook_cannot_resurrect_profile_uid/);
  assert.match(validation, /public\.draft_media_sessions/);
});

test("webhook validation rejects unsafe payloads before profile mutation", () => {
  const webhook = read("supabase/functions/video-webhook/index.ts");

  assert.match(webhook, /req\.method !== "POST"/);
  assert.match(webhook, /BUNNY_WEBHOOK_SIGNING_KEY/);
  assert.match(webhook, /req\.text\(\)/);
  assert.doesNotMatch(webhook, /req\.json\(\)/);
  assert.match(webhook, /verifyBunnyStreamWebhookSignature/);
  assert.match(webhook, /getBearerToken/);
  assert.match(webhook, /auth_mode: authResult\.authMode/);
  assert.match(webhook, /signature_key_configured: authResult\.signatureKeyConfigured/);
  assert.equal(webhook.includes(["signature", "key", "source"].join("_")), false);
  assert.match(webhook, /legacy_query_token_fallback: true/);
  assert.match(webhook, /constantTimeCompare\(bearerToken, webhookToken\)/);
  assert.match(webhook, /constantTimeCompare\(legacyToken, webhookToken\)/);
  assert.match(webhook, /hasSignatureHeaders && signatureKeyConfigured/);
  assert.ok(
    webhook.indexOf("if (!authResult.ok)") < webhook.indexOf("JSON.parse(rawBody)"),
    "webhook JSON must be parsed only after authentication succeeds",
  );
  assert.match(
    webhook,
    /reason: "invalid_json"[\s\S]*?return new Response\("Bad request", \{ status: 400 \}\)/,
  );
  assert.match(webhook, /isValidVideoGuid\(VideoGuid\)/);
  assert.match(webhook, /VideoLibraryId/);
  assert.match(webhook, /from\("draft_media_sessions"\)/);
  assert.match(webhook, /eq\("media_type", "vibe_video"\)/);
  assert.match(webhook, /eq\("provider_id", VideoGuid\)/);
  assert.match(webhook, /video_webhook_session_not_found_modern_asset_ignored/);
  assert.match(webhook, /eq\("bunny_video_uid", VideoGuid\)/);
  assert.ok(
    webhook.indexOf("video_webhook_session_not_found_modern_asset_ignored") <
      webhook.indexOf("video_webhook_legacy_profile_update_succeeded"),
    "modern session lookup must happen before legacy profile fallback",
  );
  assert.doesNotMatch(webhook, /console\.log\(`\[video-webhook\]/);
});

test("Bunny Stream webhook signature helper validates official v1 raw-body HMAC contract with read-only signing key", async () => {
  const rawBody = '{"VideoGuid":"11111111-1111-4111-8111-111111111111","Status":3}';
  const webhookSigningKey = "stream-read-only-api-key";
  const signature = createHmac("sha256", webhookSigningKey).update(rawBody).digest("hex");
  const headers = new Headers({
    "X-BunnyStream-Signature-Version": "v1",
    "X-BunnyStream-Signature-Algorithm": "hmac-sha256",
    "X-BunnyStream-Signature": signature,
  });

  assert.equal(hasAnyBunnyStreamSignatureHeader(headers), true);
  assert.deepEqual(
    await verifyBunnyStreamWebhookSignature(headers, rawBody, webhookSigningKey),
    { ok: true },
  );

  const webhook = read("supabase/functions/video-webhook/index.ts");
  assert.match(webhook, /const webhookSigningKey = Deno\.env\.get\("BUNNY_WEBHOOK_SIGNING_KEY"\)/);
  assert.doesNotMatch(webhook, /verifyBunnyStreamWebhookSignature\([\s\S]*?streamApiKey/);
});

test("Bunny Stream webhook missing signing key is explicit and rollout fallback remains possible", async () => {
  const rawBody = '{"VideoGuid":"11111111-1111-4111-8111-111111111111","Status":3}';
  const signature = createHmac("sha256", "not-configured").update(rawBody).digest("hex");

  assert.deepEqual(
    await verifyBunnyStreamWebhookSignature(
      new Headers({
        "X-BunnyStream-Signature-Version": "v1",
        "X-BunnyStream-Signature-Algorithm": "hmac-sha256",
        "X-BunnyStream-Signature": signature,
      }),
      rawBody,
      "",
    ),
    { ok: false, reason: "signature_secret_unconfigured" },
  );

  const webhook = read("supabase/functions/video-webhook/index.ts");
  assert.ok(
    webhook.indexOf("hasSignatureHeaders && signatureKeyConfigured") <
      webhook.indexOf("constantTimeCompare(legacyToken, webhookToken)"),
    "missing signature key must leave legacy token fallback reachable during rollout",
  );
  assert.match(webhook, /signature_key_configured: authResult\.signatureKeyConfigured/);
});

test("invalid Bunny Stream signature with valid legacy token still rejects before JSON trust", async () => {
  const rawBody = '{"VideoGuid":"11111111-1111-4111-8111-111111111111","Status":3}';
  const webhookSigningKey = "stream-read-only-api-key";
  const wrongSignature = createHmac("sha256", "wrong-key").update(rawBody).digest("hex");

  assert.deepEqual(
    await verifyBunnyStreamWebhookSignature(
      new Headers({
        "X-BunnyStream-Signature-Version": "v1",
        "X-BunnyStream-Signature-Algorithm": "hmac-sha256",
        "X-BunnyStream-Signature": wrongSignature,
      }),
      rawBody,
      webhookSigningKey,
    ),
    { ok: false, reason: "invalid_signature" },
  );

  const webhook = read("supabase/functions/video-webhook/index.ts");
  const signatureBranch = webhook.indexOf("if (hasSignatureHeaders && signatureKeyConfigured)");
  const invalidSignatureReturn = webhook.indexOf('reason: "invalid_signature"', signatureBranch);
  const legacyTokenCompare = webhook.indexOf("constantTimeCompare(legacyToken, webhookToken)", signatureBranch);
  const unauthorizedResponse = webhook.indexOf('return new Response("Unauthorized", { status: 401 })');
  const jsonParse = webhook.indexOf("JSON.parse(rawBody)");

  assert.ok(signatureBranch >= 0, "signature-header auth branch must exist");
  assert.ok(invalidSignatureReturn > signatureBranch, "invalid signature must return an auth failure result");
  assert.ok(
    invalidSignatureReturn < legacyTokenCompare,
    "invalid signature must not fall through to legacy token auth even when ?token= is valid",
  );
  assert.ok(
    unauthorizedResponse < jsonParse,
    "invalid auth must return 401 before any JSON payload is trusted",
  );
});

test("Bunny Stream webhook signature helper rejects malformed and invalid signatures", async () => {
  const rawBody = '{"VideoGuid":"11111111-1111-4111-8111-111111111111","Status":3}';
  const webhookSigningKey = "stream-read-only-api-key";
  const signature = createHmac("sha256", webhookSigningKey).update(rawBody).digest("hex");
  const invalidSignature = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;

  assert.deepEqual(
    await verifyBunnyStreamWebhookSignature(
      new Headers({
        "X-BunnyStream-Signature-Version": "v1",
        "X-BunnyStream-Signature-Algorithm": "hmac-sha256",
        "X-BunnyStream-Signature": signature.toUpperCase(),
      }),
      rawBody,
      webhookSigningKey,
    ),
    { ok: false, reason: "malformed_signature" },
  );

  assert.deepEqual(
    await verifyBunnyStreamWebhookSignature(
      new Headers({
        "X-BunnyStream-Signature-Version": "v1",
        "X-BunnyStream-Signature-Algorithm": "hmac-sha256",
        "X-BunnyStream-Signature": invalidSignature,
      }),
      rawBody,
      webhookSigningKey,
    ),
    { ok: false, reason: "invalid_signature" },
  );

  assert.deepEqual(
    await verifyBunnyStreamWebhookSignature(
      new Headers({
        "X-BunnyStream-Signature": signature,
      }),
      rawBody,
      webhookSigningKey,
    ),
    { ok: false, reason: "missing_signature_version" },
  );
});

test("authenticated Vibe Video status sync repairs uploaded Bunny videos without exposing secrets", () => {
  const config = read("supabase/config.toml");
  const syncFunction = read("supabase/functions/sync-vibe-video-status/index.ts");
  const controller = read("src/lib/heroVideo/heroVideoUploadController.ts");
  const studio = read("src/pages/VibeStudio.tsx");
  const webSync = read("src/lib/vibeVideo/syncVibeVideoStatus.ts");

  assert.match(config, /\[functions\.sync-vibe-video-status\][\s\S]*?verify_jwt = true/);
  assert.match(syncFunction, /BUNNY_WEBHOOK_SIGNING_KEY/);
  assert.match(syncFunction, /BUNNY_STREAM_API_KEY/);
  assert.match(syncFunction, /function getBunnyVideo/);
  assert.match(syncFunction, /streamApiKey !== readKey/);
  assert.match(syncFunction, /attemptedStreamApiKey/);
  assert.match(syncFunction, /GET/);
  assert.match(syncFunction, /https:\/\/video\.bunnycdn\.com\/library\/\$\{libraryId\}\/videos\/\$\{videoId\}/);
  assert.match(syncFunction, /status === 3 \|\| status === 4/);
  assert.match(syncFunction, /status === 5 \|\| status === 8/);
  assert.match(syncFunction, /update_media_session_status/);
  assert.match(syncFunction, /requestedVideoId !== currentVideoId/);
  assert.doesNotMatch(syncFunction, /provider_meta|signature|expirationTime|AccessKey: apiKey,/);
  assert.match(webSync, /supabase\.functions\.invoke<SyncVibeVideoStatusResult>\(\s*"sync-vibe-video-status"/);
  assert.match(controller, /syncCurrentVibeVideoStatus\(expectedVideoId, "processing_poll"\)/);
  assert.match(studio, /syncCurrentVibeVideoStatus\(effectiveVibeVideo\.bunnyVideoUid, "manual_refresh"\)/);
});

test("Vibe Video telemetry events are wired on web and native", () => {
  const webTelemetry = read("src/lib/vibeVideo/vibeVideoTelemetry.ts");
  const nativeTelemetry = read("apps/mobile/lib/vibeVideoTelemetry.ts");
  const webController = read("src/lib/heroVideo/heroVideoUploadController.ts");
  const nativeController = read("apps/mobile/lib/nativeHeroVideoUploadController.ts");
  const edgeLogs = read("supabase/functions/_shared/vibe-video-logs.ts");
  const videoWebhook = read("supabase/functions/video-webhook/index.ts");
  const deleteFunction = read("supabase/functions/delete-vibe-video/index.ts");
  const webReportWizard = read("src/components/safety/ReportWizard.tsx");
  const webChatHeader = read("src/components/chat/ChatHeader.tsx");
  const webMessages = read("src/hooks/useMessages.ts");
  const nativeReportFlow = read("apps/mobile/components/match/ReportFlowModal.tsx");

  const requiredEvents = [
    "vibe_video_credentials_request_started",
    "vibe_video_credentials_request_succeeded",
    "vibe_video_credentials_request_failed",
    "vibe_video_tus_upload_started",
    "vibe_video_tus_upload_succeeded",
    "vibe_video_tus_upload_failed",
    "vibe_video_upload_stalled",
    "vibe_video_processing_poll_started",
    "vibe_video_processing_status_changed",
    "vibe_video_processing_stalled",
    "vibe_video_stale_processing_observed",
    "vibe_video_ready_observed",
    "vibe_video_failed_observed",
    "vibe_video_playback_attempted",
    "vibe_video_playback_succeeded",
    "vibe_video_playback_failed",
    "vibe_video_cdn_hostname_fallback_used",
    "vibe_video_delete_requested",
    "vibe_video_delete_succeeded_locally",
    "vibe_video_replace_started",
    "vibe_video_caption_preserved",
    "vibe_video_caption_edited",
    "vibe_video_caption_cleared",
    "vibe_video_profile_report_submitted",
  ];

  for (const source of [webTelemetry, nativeTelemetry]) {
    for (const eventName of requiredEvents) {
      assert.match(source, new RegExp(eventName));
    }
    assert.doesNotMatch(source, /signedUrl|Authorization/);
    assert.doesNotMatch(source, /\|file\|/);
  }

  assert.match(webController, /VIBE_VIDEO_EVENTS\.credentialsRequestStarted/);
  assert.match(webController, /VIBE_VIDEO_EVENTS\.processingStalled/);
  assert.match(webController, /trackStaleVibeVideoProcessing/);
  assert.match(nativeController, /VIBE_VIDEO_EVENTS\.credentialsRequestStarted/);
  assert.match(nativeController, /VIBE_VIDEO_EVENTS\.processingStalled/);
  assert.match(nativeController, /trackStaleVibeVideoProcessing/);
  assert.match(webReportWizard, /profileReportSubmitted/);
  assert.match(webReportWizard, /reportedHasVibeVideo/);
  assert.match(webChatHeader, /reportedHasVibeVideo/);
  assert.match(webMessages, /bunny_video_uid/);
  assert.match(nativeReportFlow, /profileReportSubmitted/);
  assert.match(videoWebhook, /video_webhook_status_mapped/);
  assert.match(deleteFunction, /delete_vibe_video_deferred_remote_delete_job_created/);
  assert.match(edgeLogs, /JSON\.stringify/);
  assert.match(edgeLogs, /SENSITIVE_KEY_PATTERN/);
  assert.doesNotMatch(edgeLogs, /\|file\|/);
});

test("Vibe Video CDN hostname telemetry covers missing web config and native persisted-host mismatch", () => {
  const webState = read("src/lib/vibeVideo/webVibeVideoState.ts");
  const webTelemetry = read("src/lib/vibeVideo/vibeVideoTelemetry.ts");
  const nativePlaybackUrl = read("apps/mobile/lib/vibeVideoPlaybackUrl.ts");
  const nativeTelemetry = read("apps/mobile/lib/vibeVideoTelemetry.ts");
  const mismatchStart = nativePlaybackUrl.indexOf("function trackCdnHostnamePersistenceMismatch");
  const mismatchEnd = nativePlaybackUrl.indexOf("/**", mismatchStart);
  const mismatchFunction = nativePlaybackUrl.slice(mismatchStart, mismatchEnd);

  assert.match(webTelemetry, /vibe_video_cdn_hostname_fallback_used/);
  assert.match(webState, /let webCdnHostnameFallbackReported = false/);
  assert.match(webState, /function trackWebCdnHostnameFallbackUsed/);
  assert.match(webState, /if \(webCdnHostnameFallbackReported\) return/);
  assert.match(webState, /VIBE_VIDEO_EVENTS\.cdnHostnameFallbackUsed/);
  assert.match(webState, /kind: "cdn_hostname_missing"/);
  assert.match(webState, /stream_hostname_source: "missing"/);
  assert.match(webState, /reason: "env_missing" \| "normalized_empty"/);
  assert.match(webState, /if \(!hostname\) \{/);
  assert.match(webState, /return hostname/);

  assert.match(nativeTelemetry, /vibe_video_cdn_hostname_persistence_mismatch/);
  assert.match(nativePlaybackUrl, /let reportedEnvPersistedMismatch = false/);
  assert.match(nativePlaybackUrl, /function trackCdnHostnamePersistenceMismatch/);
  assert.match(nativePlaybackUrl, /if \(reportedEnvPersistedMismatch\) return/);
  assert.match(nativePlaybackUrl, /VIBE_VIDEO_EVENTS\.cdnHostnamePersistenceMismatch/);
  assert.match(nativePlaybackUrl, /kind: 'env_persisted_hostname_mismatch'/);
  assert.match(nativePlaybackUrl, /stream_hostname_source: 'env'/);
  assert.match(nativePlaybackUrl, /env_hostname_present: true/);
  assert.match(nativePlaybackUrl, /persisted_hostname_present: true/);
  assert.match(nativePlaybackUrl, /trackCdnHostnamePersistenceMismatch\('native_playback_hostname_resolver'\)/);
  assert.match(nativePlaybackUrl, /trackCdnHostnamePersistenceMismatch\('native_playback_hostname_persist'\)/);
  assert.doesNotMatch(mismatchFunction, /\b(env|persisted|hostname|url):/);
  assert.doesNotMatch(mismatchFunction, /https?:\/\//);
});

test("native Vibe Video playback stays on expo-video and never imports expo-av", () => {
  const mobileSources = readTreeFiles("apps/mobile", new Set([".ts", ".tsx"]));
  const offenders = mobileSources.filter((path) => {
    const content = read(path);
    return /from ['"]expo-av['"]|require\(['"]expo-av['"]\)/.test(content);
  });

  assert.deepEqual(offenders, []);
  assert.match(read("apps/mobile/components/video/VibeVideoPlayer.tsx"), /from 'expo-video'/);
});

test("native Vibe Video surfaces use canonical resolver state for non-playable UI", () => {
  const resolver = read("apps/mobile/lib/vibeVideoState.ts");
  const fullView = read("apps/mobile/components/profile/UserProfileFullView.tsx");
  const fullscreenModal = read("apps/mobile/components/video/FullscreenVibeVideoModal.tsx");
  const studio = read("apps/mobile/app/vibe-studio.tsx");
  const controller = read("apps/mobile/lib/nativeHeroVideoUploadController.ts");

  assert.match(resolver, /resolveCanonicalVibeVideoState/);
  assert.match(resolver, /state: 'processing'/);
  assert.match(resolver, /canonical\.state === 'processing' \|\| canonical\.state === 'stale_processing'/);
  assert.doesNotMatch(resolver, /state: 'uploading'/);
  assert.match(fullView, /Vibe Video processing/);
  assert.match(fullView, /Vibe Video still processing/);
  assert.match(fullView, /Their clip is saved and getting ready for playback/);
  assert.match(fullView, /Their clip is saved, but playback is taking longer than usual/);
  assert.match(fullView, /effectiveVibeVideoState = signedVibeVideoRef \? 'ready' : vibeInfo\.state/);
  assert.match(fullView, /vibeVideoState=\{effectiveVibeVideoState\}/);
  assert.match(fullscreenModal, /canonicalUrlState/);
  assert.match(studio, /vibeVideoState=\{videoInfo\.state\}/);
  assert.match(controller, /phase: 'processing'/);
  assert.match(controller, /type PollStartSource = 'upload_complete' \| 'profile_load'/);
});

test("web Vibe Video surfaces use resolver-owned readiness and processing states", () => {
  const drops = read("src/components/matches/DropsTabContent.tsx");
  const card = read("src/components/hero-video/HeroVideoStatusCard.tsx");
  const fullscreen = read("src/components/vibe-video/VibeVideoFullscreenPlayer.tsx");
  const thumbnail = read("src/components/vibe-video/VibeVideoThumbnail.tsx");
  const wizard = read("src/components/wizard/ProfileWizard.tsx");
  const userProfile = read("src/pages/UserProfile.tsx");
  const drawer = read("src/components/ProfileDetailDrawer.tsx");
  const otherUserFullProfile = read("src/components/profile/OtherUserFullProfileView.tsx");
  const otherUserViewModel = read("shared/profile/otherUserProfileViewModel.ts");

  assert.match(drops, /resolveWebVibeVideoState/);
  assert.match(drops, /vibeVideoBadgeLabel/);
  assert.match(drops, /Vibe Video processing/);
  assert.doesNotMatch(drops, /partner\.bunny_video_uid && partner\.bunny_video_status === 'ready'/);

  assert.match(card, /backendInfo\.state === "error"/);
  assert.match(card, /Vibe Video needs attention/);
  assert.match(card, /Video saved, playback needs attention/);
  assert.match(card, /NEEDS CHECK/);
  assert.match(card, /backendInfo\.state === "processing" \|\| backendInfo\.state === "stale_processing"/);
  assert.match(card, /Still processing your Vibe Video/);
  assert.doesNotMatch(card, /None \/ error/);

  assert.match(userProfile, /OtherUserFullProfileView/);
  assert.match(drawer, /OtherUserFullProfileView/);
  assert.match(otherUserViewModel, /updated_at\?: string \| null;/);
  assert.match(otherUserViewModel, /updatedAt: string \| null;/);
  assert.match(otherUserViewModel, /updatedAt: cleanString\(source\.updated_at\)/);
  assert.match(otherUserFullProfile, /updated_at: profile\.updatedAt/);
  assert.match(otherUserFullProfile, /Vibe Video processing/);
  assert.match(otherUserFullProfile, /Vibe Video still processing/);
  assert.match(otherUserFullProfile, /Vibe Video needs a fresh take/);
  assert.match(otherUserFullProfile, /Their clip is saved and getting ready for playback/);

  assert.match(fullscreen, /resolveWebVibeVideoState/);
  assert.doesNotMatch(fullscreen, /normalizeBunnyVideoStatus/);
  assert.doesNotMatch(fullscreen, /getWebVibeVideoPlaybackUrl/);
  assert.match(thumbnail, /callers must pass resolver-ready URLs/);
  assert.match(thumbnail, /canPreviewVideo/);
  assert.match(thumbnail, /safeVideoUrl/);

  assert.match(wizard, /loadedHasVideo = !!profile\.bunnyVideoUid\?\.trim\(\);/);
  assert.doesNotMatch(wizard, /profile\.bunnyVideoUid \|\| profile\.bunnyVideoStatus === "ready"/);
});

test("native Stream CDN missing config is explicit and not hidden by a hardcoded fallback", () => {
  const playbackUrl = read("apps/mobile/lib/vibeVideoPlaybackUrl.ts");
  const fullscreenModal = read("apps/mobile/components/video/FullscreenVibeVideoModal.tsx");
  const runbook = read("apps/mobile/docs/native-vibe-video-runbook.md");

  assert.doesNotMatch(playbackUrl, /STREAM_CDN_FALLBACK_HOST/);
  assert.doesNotMatch(playbackUrl, /vz-5585ddfc-604\.b-cdn\.net/);
  assert.doesNotMatch(playbackUrl, /source: 'fallback'/);
  assert.doesNotMatch(playbackUrl, /playback\.hostname\.fallback_used/);
  assert.match(playbackUrl, /export type StreamHostnameSource = 'env' \| 'persisted' \| 'missing';/);
  assert.match(playbackUrl, /hostname: string \| null/);
  assert.match(playbackUrl, /playback\.hostname\.missing/);
  assert.match(playbackUrl, /kind: 'cdn_hostname_missing'/);
  assert.match(playbackUrl, /stream_hostname_source: 'missing'/);
  assert.match(playbackUrl, /VIBE_VIDEO_EVENTS\.cdnHostnameFallbackUsed/);
  assert.match(playbackUrl, /let cachedCdnHostname: string \| null = null/);
  assert.match(playbackUrl, /if \(!uid \|\| !hostname\) return null/);
  assert.match(fullscreenModal, /const configMissing = !streamHostname;/);
  assert.match(fullscreenModal, /vibeVideoState: VibeVideoState/);
  assert.match(fullscreenModal, /Video still processing/);
  assert.doesNotMatch(fullscreenModal, /No\s+video/);
  assert.doesNotMatch(fullscreenModal, /streamHostname\.trim\(\)/);
  assert.match(runbook, /Do not mask missing config with a hardcoded Stream hostname/);
  assert.match(runbook, /kind: "cdn_hostname_missing"/);
});

test("native upload flow preserves real source telemetry and 15-second duration copy", () => {
  const controller = read("apps/mobile/lib/nativeHeroVideoUploadController.ts");
  const record = read("apps/mobile/app/vibe-video-record.tsx");
  const onboardingStep = read("apps/mobile/components/onboarding/steps/VibeVideoStep.tsx");

  assert.match(controller, /type VibeVideoUploadSource/);
  assert.match(controller, /uploadSource\?: VibeVideoUploadSource/);
  assert.match(controller, /resolvedUploadSource/);
  assert.match(controller, /upload_source: uploadSource/);
  assert.match(controller, /\{ signal: uploadAc\.signal, uploadSource \}/);
  assert.doesNotMatch(controller, /uploadSource: 'unknown'/);

  assert.doesNotMatch(record, /useFeatureFlag\('media_v2_video'\)/);
  assert.match(record, /startNativeVibeVideoUpload\(\{[\s\S]{0,220}uri: recordedUri[\s\S]{0,220}uploadSource: uploadSourceRef\.current/);
  assert.doesNotMatch(record, /mediaV2VideoEnabled: mediaV2Video\.enabled/);
  assert.match(record, /videoMaxDuration: MAX_DURATION_SEC/);
  assert.doesNotMatch(record, /videoMaxDuration: 20/);
  assert.match(onboardingStep, /Up to 15 seconds/);
  assert.doesNotMatch(onboardingStep, /30-second intro videos/);
});

test("media v2 Vibe Video attempts are schema-backed and dual-written by server paths", () => {
  const migration = read("supabase/migrations/20260519133000_vibe_video_uploads.sql");
  const createUpload = read("supabase/functions/create-video-upload/index.ts");
  const syncStatus = read("supabase/functions/sync-vibe-video-status/index.ts");
  const deleteVideo = read("supabase/functions/delete-vibe-video/index.ts");
  const webhook = read("supabase/functions/video-webhook/index.ts");
  const webController = read("src/lib/heroVideo/heroVideoUploadController.ts");
  const nativeApi = read("apps/mobile/lib/vibeVideoApi.ts");
  const nativeController = read("apps/mobile/lib/nativeHeroVideoUploadController.ts");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.vibe_video_uploads/);
  assert.match(migration, /client_request_id\s+uuid\s+NOT NULL/);
  assert.match(migration, /CHECK \(status IN \('uploading', 'processing', 'ready', 'failed', 'superseded'\)\)/);
  assert.match(migration, /UNIQUE \(user_id, client_request_id\)/);
  assert.match(migration, /UNIQUE \(provider_object_id\)/);
  assert.match(migration, /ALTER TABLE public\.vibe_video_uploads ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /USING \(auth\.uid\(\) = user_id\)/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.vibe_video_uploads TO authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.vibe_video_uploads TO service_role/);
  assert.match(migration, /CREATE TRIGGER trg_sync_vibe_video_upload_from_dms/);
  assert.match(migration, /public\.vibe_video_upload_status_from_session\(NEW\.status\)/);
  assert.match(migration, /WHEN 'deleted' THEN 'superseded'/);
  assert.match(migration, /WHEN 'abandoned' THEN 'superseded'/);

  assert.match(createUpload, /parseClientRequestId/);
  assert.match(createUpload, /isValidVideoGuid/);
  assert.match(createUpload, /client_request_id: clientRequestId/);
  assert.match(createUpload, /\.from\("vibe_video_uploads"\)/);
  assert.match(createUpload, /\.eq\("user_id", user\.id\)[\s\S]+\.eq\("client_request_id", clientRequestId\)/);
  assert.match(createUpload, /create_video_upload_attempt_reused/);
  assert.match(createUpload, /create_video_upload_attempt_reused_after_duplicate/);
  assert.match(createUpload, /upload_attempt_terminal/);
  assert.match(createUpload, /upload_attempt_not_durable/);
  assert.match(createUpload, /create_video_upload_attempt_state_refresh_failed/);
  assert.match(createUpload, /upload_attempt_state_refresh_failed/);
  assert.equal(
    createUpload.match(/uploadAttemptStateRefreshFailureResponse\(\{/g)?.length,
    2,
    "both reusable-attempt branches must return a 5xx when durable-state refresh fails",
  );
  assert.match(createUpload, /durable_via_profile/);
  assert.match(createUpload, /repairableLifecycleState: durableAttemptMediaAssetId\(reusableAttempt\) == null/);
  assert.match(createUpload, /provider_object_id: videoId/);
  assert.match(createUpload, /media_asset_id: mediaAssetId/);
  assert.match(createUpload, /draft_media_session_id: sessionId/);
  assert.match(createUpload, /link_vibe_video_upload_attempt_session/);
  assert.match(createUpload, /attemptAssetLinkRepairable/);
  assert.match(createUpload, /uploadAttemptId: attemptRow\.id/);
  assert.match(createUpload, /status: "superseded", error_detail: "replaced_by_new_upload"/);
  assert.match(createUpload, /@supabase\/supabase-js@2\.88\.0/);

  assert.match(webController, /newHeroVideoClientRequestId/);
  assert.match(webController, /heroVideoStartWithClientRequestId/);
  assert.match(webController, /const uploadClientRequestId = clientRequestId\.trim\(\) \|\| newHeroVideoClientRequestId\(\)/);
  assert.match(webController, /body: JSON\.stringify\(\{[\s\S]+context,[\s\S]+client_request_id: clientRequestId,[\s\S]+source_bytes:[\s\S]+mime_type:[\s\S]+\}\)/);
  assert.match(webController, /title: `vibe-video-\$\{clientRequestId\}`/);
  assert.match(nativeApi, /export function newVibeVideoClientRequestId/);
  assert.match(nativeApi, /client_request_id: clientRequestId/);
  assert.match(nativeController, /nativeHeroVideoStartWithClientRequestId/);
  assert.match(nativeController, /const uploadClientRequestId = clientRequestId\.trim\(\) \|\| newVibeVideoClientRequestId\(\)/);
  assert.match(nativeController, /getCreateVideoUploadCredentials\(\{[\s\S]+context,[\s\S]+clientRequestId,[\s\S]+mimeType:[\s\S]+\}\)/);

  assert.match(syncStatus, /\.from\("vibe_video_uploads"\)/);
  assert.match(syncStatus, /attemptPatch/);
  assert.match(syncStatus, /status: mappedStatus/);
  assert.match(syncStatus, /uploadAttemptId: attemptRow\?\.id \?\? null/);
  assert.match(syncStatus, /@supabase\/supabase-js@2\.88\.0/);

  assert.match(deleteVideo, /\.from\("vibe_video_uploads"\)/);
  assert.match(deleteVideo, /status: "superseded", error_detail: "user_deleted"/);
  assert.match(deleteVideo, /\.in\("status", \["uploading", "processing", "ready", "failed", "superseded"\]\)/);
  assert.match(deleteVideo, /uploadAttemptId: attemptRow\?\.id \?\? null/);
  assert.match(deleteVideo, /@supabase\/supabase-js@2\.88\.0/);

  assert.match(webhook, /type VibeVideoUploadAttemptStatus = "processing" \| "ready" \| "failed"/);
  assert.match(webhook, /syncVibeVideoUploadAttemptFromWebhook/);
  assert.match(webhook, /\.from\("vibe_video_uploads"\)/);
  assert.match(webhook, /draftMediaSessionId: typeof sr\.session_id === "string" \? sr\.session_id : null/);
  assert.match(webhook, /video_webhook_vibe_video_upload_attempt_update_failed/);
  assert.match(webhook, /upload_attempt_id: attemptSync\.attemptId/);
});

test("media v2 Vibe Video caller cutover is upload-start gated and still controller-backed", () => {
  const webStep = read("src/pages/onboarding/steps/VibeVideoStep.tsx");
  const webModal = read("src/components/vibe-video/VibeStudioModal.tsx");
  const webSdk = read("src/lib/mediaSdk/webVideoUploads.ts");
  const nativeRecord = read("apps/mobile/app/vibe-video-record.tsx");
  const nativeSdk = read("apps/mobile/lib/mediaSdk/nativeVideoUploads.ts");

  assert.doesNotMatch(webStep, /import \{ heroVideoStart \}/);
  assert.doesNotMatch(webStep, /useFeatureFlag\("media_v2_video"\)/);
  assert.match(webStep, /startWebVibeVideoUpload\(\{[\s\S]{0,180}source: file[\s\S]{0,160}context: "onboarding"/);
  assert.doesNotMatch(webStep, /mediaV2VideoEnabled: mediaV2Video\.enabled/);

  assert.doesNotMatch(webModal, /import \{ heroVideoStart \}/);
  assert.doesNotMatch(webModal, /useFeatureFlag\("media_v2_video"\)/);
  assert.match(webModal, /startWebVibeVideoUpload\(\{[\s\S]{0,180}caption: captionForUpload[\s\S]{0,180}context: uploadContext/);
  assert.doesNotMatch(webModal, /mediaV2VideoEnabled: mediaV2Video\.enabled/);

  assert.doesNotMatch(nativeRecord, /import \{ nativeHeroVideoStart \}/);
  assert.doesNotMatch(nativeRecord, /useFeatureFlag\('media_v2_video'\)/);
  assert.match(nativeRecord, /startNativeVibeVideoUpload\(\{[\s\S]{0,220}uri: recordedUri[\s\S]{0,220}context,[\s\S]{0,160}uploadSource: uploadSourceRef\.current/);
  assert.doesNotMatch(nativeRecord, /mediaV2VideoEnabled: mediaV2Video\.enabled/);

  assert.match(webSdk, /createWebMediaSdk/);
  assert.doesNotMatch(webSdk, /createStaticMediaFeatureFlagGate/);
  assert.match(webSdk, /evaluateClientFeatureFlagForUpload\("media_v2_video"\)/);
  assert.match(webSdk, /MEDIA_UPLOAD_PATH_EVENT_NAMES/);
  assert.match(webSdk, /createMediaUploadPathTelemetryFields/);
  assert.match(webSdk, /uploadVibeVideo: uploadWebVibeVideoViaController/);
  assert.match(webSdk, /heroVideoStartWithClientRequestId/);
  assert.match(webSdk, /heroVideoStartWithClientRequestId\(params\.source, params\.caption, context, clientRequestId\)/);
  assert.match(webSdk, /mirrorHeroVideoControllerToSdk/);
  assert.match(webSdk, /state\.clientRequestId !== clientRequestId/);
  assert.match(webSdk, /vibe_video_upload_replaced/);
  assert.match(webSdk, /controls\.snapshot\(\)\.clientRequestId/);
  assert.match(webSdk, /shouldResetHeroVideoForTask\(state: HeroVideoControllerState, clientRequestId: string\)/);
  assert.match(webSdk, /state\.clientRequestId === clientRequestId && state\.phase !== "ready"/);
  assert.match(webSdk, /shouldResetHeroVideoForTask\(heroVideoGetState\(\), clientRequestId\)[\s\S]{0,80}heroVideoReset\(\)/);
  assert.match(webSdk, /vibe_video_invalid_upload_context/);
  assert.match(webSdk, /waitForMediaUploadTaskTerminal/);

  assert.match(nativeSdk, /createNativeMediaSdk/);
  assert.doesNotMatch(nativeSdk, /createStaticMediaFeatureFlagGate/);
  assert.match(nativeSdk, /evaluateClientFeatureFlagForUpload\('media_v2_video'\)/);
  assert.match(nativeSdk, /MEDIA_UPLOAD_PATH_EVENT_NAMES/);
  assert.match(nativeSdk, /createMediaUploadPathTelemetryFields/);
  assert.match(nativeSdk, /AsyncStorage/);
  assert.match(nativeSdk, /FileSystem/);
  assert.match(nativeSdk, /uploadVibeVideo: uploadNativeVibeVideoViaController/);
  assert.match(nativeSdk, /nativeHeroVideoStartWithClientRequestId/);
  assert.match(nativeSdk, /nativeHeroVideoStartWithClientRequestId\([\s\S]{0,120}params\.uri[\s\S]{0,120}clientRequestId/);
  assert.match(nativeSdk, /mirrorNativeHeroVideoControllerToSdk/);
  assert.match(nativeSdk, /state\.clientRequestId !== clientRequestId/);
  assert.match(nativeSdk, /vibe_video_upload_replaced/);
  assert.match(nativeSdk, /controls\.snapshot\(\)\.clientRequestId/);
  assert.match(nativeSdk, /shouldResetHeroVideoForTask\(state: NativeHeroVideoControllerState, clientRequestId: string\)/);
  assert.match(nativeSdk, /state\.clientRequestId === clientRequestId && state\.phase !== 'ready'/);
  assert.match(nativeSdk, /shouldResetHeroVideoForTask\(nativeHeroVideoGetState\(\), clientRequestId\)[\s\S]{0,80}nativeHeroVideoReset\(\)/);
  assert.match(nativeSdk, /vibe_video_invalid_upload_context/);
  assert.match(nativeSdk, /mimeFromExtension\(extensionFromFileUri\(params\.uri\)\)/);
  assert.match(nativeSdk, /waitForMediaUploadTaskTerminal/);
});
