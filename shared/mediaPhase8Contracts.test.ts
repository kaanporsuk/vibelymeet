import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  extractChatImageMediaRef,
  formatChatImageMessageContent,
  inferChatMediaRenderKind,
  parseChatImageStructuredPayload,
} from "./chat/messageRouting.ts";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("Phase 8 chat images prefer structured payload while preserving legacy markers", () => {
  const payload = {
    v: 2,
    kind: "chat_image",
    provider: "bunny_storage",
    media_ref: "photos/user/req-abc/photo.jpg",
    client_request_id: "550e8400-e29b-41d4-a716-446655440000",
  };

  assert.equal(
    parseChatImageStructuredPayload(payload, { allowPrivateMediaRefs: true }),
    "photos/user/req-abc/photo.jpg",
  );
  assert.equal(
    extractChatImageMediaRef({
      content: formatChatImageMessageContent("photos/legacy/fallback.jpg"),
      structured_payload: payload,
    }, { allowPrivateMediaRefs: true }),
    "photos/user/req-abc/photo.jpg",
  );
  assert.equal(
    inferChatMediaRenderKind({
      content: "Photo",
      structuredPayload: payload,
    }),
    "image",
  );
  assert.equal(
    parseChatImageStructuredPayload({
      ...payload,
      provider: "unknown",
    }, { allowPrivateMediaRefs: true }),
    null,
  );
  assert.equal(
    extractChatImageMediaRef({
      content: formatChatImageMessageContent("photos/legacy/fallback.jpg"),
      structured_payload: { ...payload, v: 3 },
    }, { allowPrivateMediaRefs: true }),
    "photos/legacy/fallback.jpg",
  );
});

test("Phase 8 server contracts write and hydrate structured chat-image payloads", () => {
  const sendMessage = read("supabase/functions/send-message/index.ts");
  const threadPage = read("supabase/functions/chat-thread-page/index.ts");
  const webMessages = read("src/hooks/useMessages.ts");
  const nativeChatApi = read("apps/mobile/lib/chatApi.ts");
  const previews = read("shared/chat/conversationListPreview.ts");

  assert.match(sendMessage, /function chatImageStructuredPayload/);
  assert.match(sendMessage, /kind: "chat_image"/);
  assert.match(sendMessage, /provider: "bunny_storage"/);
  assert.match(sendMessage, /media_ref: mediaRef/);
  assert.match(sendMessage, /insertRow\.structured_payload = chatImageStructuredPayload/);
  assert.match(threadPage, /function parseStructuredChatImageRef/);
  assert.match(threadPage, /extractChatImageMediaRef\(next\)/);
  assert.match(threadPage, /payload\.media_ref = durableImageRef/);
  assert.match(webMessages, /extractChatImageMediaRef\(row, \{ allowPrivateMediaRefs: true \}\)/);
  assert.match(nativeChatApi, /extractChatImageMediaRef\(row, \{ allowPrivateMediaRefs: true \}\)/);
  assert.match(previews, /structuredPayload: row\.structured_payload/);
});

test("Phase 8 private profile Vibe Video uses signed playback refs", () => {
  const migration = read("supabase/migrations/20260519210000_media_phase_8_profile_vibe_signing.sql");
  const resolver = read("supabase/functions/get-chat-media-url/index.ts");
  const webResolver = read("src/lib/mediaAssetResolver.ts");
  const nativeResolver = read("apps/mobile/lib/mediaAssetResolver.ts");
  const webProfile = read("src/components/profile/OtherUserFullProfileView.tsx");
  const nativeProfile = read("apps/mobile/components/profile/UserProfileFullView.tsx");
  const webMediaAssetHook = read("src/hooks/useMediaAsset.ts");
  const nativeMediaAssetHook = read("apps/mobile/hooks/useMediaAsset.ts");
  const webFetcher = read("src/services/fetchUserProfile.ts");
  const nativeFetcher = read("apps/mobile/lib/fetchUserProfile.ts");

  assert.match(migration, /vibe_video_signed_playback_required/);
  assert.match(migration, /vibe_video_playback_ref/);
  assert.match(migration, /NOT public\.is_profile_discoverable\(p_target_id, v_viewer_id\)/);
  assert.match(migration, /concat\('profile_vibe_video:'/);

  assert.match(resolver, /"profile_vibe_video"/);
  assert.match(resolver, /BUNNY_STREAM_TOKEN_SECURITY_KEY/);
  assert.match(resolver, /get_profile_for_viewer/);
  assert.match(resolver, /stale_profile_vibe_video_ref/);
  assert.match(resolver, /missing_or_invalid_profile_ref/);
  assert.match(resolver, /profile_stream_url_issued/);
  assert.match(resolver, /token_path/);

  assert.match(webResolver, /parseProfileVibeVideoRef/);
  assert.match(webResolver, /profileId: profileRef\.profileId, mediaKind, sourceRef: rawRef/);
  assert.match(nativeResolver, /parseProfileVibeVideoRef/);
  assert.match(nativeResolver, /profileId: profileRef\.profileId, mediaKind, sourceRef: rawRef/);

  assert.match(webProfile, /signedVibeVideoRef/);
  assert.match(webProfile, /kind: "profile_vibe_video"/);
  assert.match(webProfile, /signedVibeVideoStatus === "ready"/);
  assert.match(nativeProfile, /signedVibeVideoRef/);
  assert.match(nativeProfile, /kind: 'profile_vibe_video'/);
  assert.match(nativeProfile, /signedVibeVideoStatus === 'ready'/);
  assert.match(webMediaAssetHook, /initialUrl === null \? null : initialUrl \?\? sourceRef \?\? null/);
  assert.match(nativeMediaAssetHook, /initialUrl === null \? null : initialUrl \?\? sourceRef \?\? null/);
  assert.match(webFetcher, /vibe_video_signed_playback_required/);
  assert.match(nativeFetcher, /vibe_video_playback_ref/);
});

test("Phase 8 Bunny Storage presign decision stays documented as EF mediated", () => {
  const closure = read("docs/media-phase8-closure.md");
  assert.match(closure, /does not expose an S3-style presigned direct-upload URL/);
  assert.match(closure, /keep photos, voice notes, and event covers flowing through Edge Functions/);
});
