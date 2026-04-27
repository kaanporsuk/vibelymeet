import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

test("inline VibePlayer uses the shared HLS attachment path", () => {
  const player = read("src/components/vibe-video/VibePlayer.tsx");
  const attach = read("src/lib/vibeVideo/attachHlsPlayback.ts");

  assert.match(player, /attachHlsPlayback/);
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
  listeners = new Map<string, Set<() => void>>();

  canPlayType(): string {
    return this.canPlayTypeValue;
  }

  play(): Promise<void> {
    this.playCount++;
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
  destroyed = false;
  handlers = new Map<string, (event: unknown, data?: { fatal?: boolean; type?: string }) => void>();

  static isSupported(): boolean {
    return FakeHls.supported;
  }

  constructor() {
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
  assert.equal(video.playCount, 1);

  cleanup();

  assert.equal(video.pauseCount, 1);
  assert.equal(video.loadCount, 1);
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

test("attachHlsPlayback reports unsupported and fatal playback errors", async () => {
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
  assert.equal(errors.at(-1), "native");
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
  const native = read("apps/mobile/lib/nativeHeroVideoUploadController.ts");
  const nativeState = read("apps/mobile/lib/vibeVideoState.ts");
  const nativePoll = read("apps/mobile/lib/vibeVideoPoll.ts");

  assert.match(web, /"stalled"/);
  assert.match(native, /'stalled'/);
  assert.match(web, /taking longer than expected/);
  assert.match(native, /taking longer than expected/);
  assert.match(nativeState, /state: 'ready'[\s\S]*canPlay: !!playbackUrl/);
  assert.match(nativeState, /state: 'failed'[\s\S]*canRecord: true/);
  assert.match(nativeState, /uid exists but status is `none`[\s\S]*state: 'processing'/);
  assert.match(nativePoll, /profile_bunny_video_uid_cleared/);
  assert.match(nativePoll, /profile_bunny_video_uid_replaced/);
});

test("UID-only Vibe Score and onboarding UID preservation remain source-backed", () => {
  const migration = read("supabase/migrations/20260501101000_vibe_video_contract_hardening.sql");
  const repairMigration = read("supabase/migrations/20260501123000_vibe_video_backend_contract_repair.sql");
  const repairValidation = read("supabase/validation/vibe_video_backend_contract_repair.sql");
  const webIncomplete = read("src/lib/vibeScoreIncompleteActions.ts");
  const nativeIncomplete = read("apps/mobile/lib/vibeScoreIncompleteActions.ts");

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
});

test("create-video-upload requires durable media-session state before credentials are returned", () => {
  const edge = read("supabase/functions/create-video-upload/index.ts");

  const sessionCreateIdx = edge.indexOf('"create_media_session"');
  const profileActivateIdx = edge.indexOf('"activate_profile_vibe_video"');
  assert.ok(sessionCreateIdx >= 0, "create_media_session call missing");
  assert.ok(profileActivateIdx >= 0, "activate_profile_vibe_video call missing");
  assert.ok(
    sessionCreateIdx < profileActivateIdx,
    "media session must be durable before profile UID activation",
  );

  assert.match(edge, /media_session_create_failed/);
  assert.match(edge, /cleanupCreatedVideo\(libraryId, apiKey, videoId, user\.id, projectRef, "session_creation_failed"\)/);
  assert.match(edge, /create_video_upload_media_session_create_rejected/);
  assert.match(edge, /create_video_upload_media_session_uploading_mark_failed_but_repairable/);
  assert.match(edge, /repairableLifecycleState/);
  assert.match(edge, /if \(sessionError\) \{[\s\S]*?media_session_create_failed[\s\S]*?return json/);
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
  assert.match(webhook, /constantTimeCompare\(token, webhookToken\)/);
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
  assert.match(nativeController, /VIBE_VIDEO_EVENTS\.credentialsRequestStarted/);
  assert.match(nativeController, /VIBE_VIDEO_EVENTS\.processingStalled/);
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

test("native Vibe Video playback stays on expo-video and never imports expo-av", () => {
  const mobileSources = readTreeFiles("apps/mobile", new Set([".ts", ".tsx"]));
  const offenders = mobileSources.filter((path) => {
    const content = read(path);
    return /from ['"]expo-av['"]|require\(['"]expo-av['"]\)/.test(content);
  });

  assert.deepEqual(offenders, []);
  assert.match(read("apps/mobile/components/video/VibeVideoPlayer.tsx"), /from 'expo-video'/);
});

test("native Bunny CDN fallback remains explicit and telemetry-visible", () => {
  const playbackUrl = read("apps/mobile/lib/vibeVideoPlaybackUrl.ts");

  assert.match(playbackUrl, /STREAM_CDN_FALLBACK_HOST/);
  assert.match(playbackUrl, /playback\.hostname\.fallback_used/);
  assert.match(playbackUrl, /VIBE_VIDEO_EVENTS\.cdnHostnameFallbackUsed/);
  assert.match(playbackUrl, /let cachedCdnHostname: string \| null = null/);
  assert.doesNotMatch(playbackUrl, /cachedCdnHostname\s*=\s*STREAM_CDN_FALLBACK_NORMALIZED/);
});
