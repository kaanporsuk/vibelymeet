import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMeetingTokenProperties,
  buildVideoDateRoomProperties,
  classifyDeleteRoomSafety,
  evaluateDailyProductionConfigReadiness,
  isDailyRoomAlreadyExistsErrorText,
  isDailyRoomUrlForName,
  planDailyProviderRoomRecovery,
  resolveCanonicalVideoDateRoom,
  resolveDailyRuntimeConfig,
} from "./dailyRoomContracts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const DAILY_DOMAIN = "vibelyapp.daily.co";
const ROOM_NAME = "date-11111111111141118111111111111111";
const ROOM_URL = `https://${DAILY_DOMAIN}/${ROOM_NAME}`;

test("video date session always resolves to one canonical Daily room", () => {
  const first = resolveCanonicalVideoDateRoom({
    sessionId: SESSION_ID,
    dailyDomain: DAILY_DOMAIN,
  });
  const retry = resolveCanonicalVideoDateRoom({
    sessionId: SESSION_ID,
    dailyDomain: DAILY_DOMAIN,
    existingRoomName: ROOM_NAME,
    existingRoomUrl: ROOM_URL,
  });
  const staleMetadata = resolveCanonicalVideoDateRoom({
    sessionId: SESSION_ID,
    dailyDomain: DAILY_DOMAIN,
    existingRoomName: "date-stale",
    existingRoomUrl: "https://vibelyapp.daily.co/date-stale",
  });

  assert.deepEqual(first, {
    roomName: ROOM_NAME,
    roomUrl: ROOM_URL,
    metadataMatchesCanonical: false,
  });
  assert.deepEqual(retry, {
    roomName: ROOM_NAME,
    roomUrl: ROOM_URL,
    metadataMatchesCanonical: true,
  });
  assert.equal(staleMetadata.roomName, ROOM_NAME);
  assert.equal(staleMetadata.roomUrl, ROOM_URL);
  assert.equal(staleMetadata.metadataMatchesCanonical, false);
});

test("Daily room URL validation is bound to the expected domain and room", () => {
  assert.equal(isDailyRoomUrlForName(ROOM_URL, ROOM_NAME, DAILY_DOMAIN), true);
  assert.equal(isDailyRoomUrlForName(`${ROOM_URL}/`, ROOM_NAME, DAILY_DOMAIN), true);
  assert.equal(isDailyRoomUrlForName(`http://${DAILY_DOMAIN}/${ROOM_NAME}`, ROOM_NAME, DAILY_DOMAIN), false);
  assert.equal(isDailyRoomUrlForName(`https://evil.example/${ROOM_NAME}`, ROOM_NAME, DAILY_DOMAIN), false);
  assert.equal(isDailyRoomUrlForName(`https://${DAILY_DOMAIN}/other-room`, ROOM_NAME, DAILY_DOMAIN), false);
  assert.equal(isDailyRoomUrlForName("not a url", ROOM_NAME, DAILY_DOMAIN), false);
});

test("Daily production config readiness blocks missing fallback launch posture without exposing secrets", () => {
  const blocked = evaluateDailyProductionConfigReadiness({
    dailyApiKey: "",
    dailyDomainEnv: "",
    dailyWebhookSecret: "placeholder",
    cleanupCronSecret: null,
  });

  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockers, [
    "daily_api_key_missing",
    "daily_domain_missing",
    "daily_domain_fallback_used",
    "daily_webhook_secret_missing",
    "daily_cleanup_cron_secret_missing",
  ]);

  const ready = evaluateDailyProductionConfigReadiness({
    dailyApiKey: "daily_live_key_present",
    dailyDomainEnv: DAILY_DOMAIN,
    dailyWebhookSecret: "base64-hmac-present",
    cleanupCronSecret: "cron-secret-present",
  });
  assert.deepEqual(ready, { ready: true, blockers: [] });
});

test("Daily runtime config blocks production fallback and allows only explicit local fallback", () => {
  const productionBlocked = resolveDailyRuntimeConfig({
    dailyApiKey: "daily_live_key_present",
    dailyDomainEnv: "",
    environment: "production",
    allowLocalFallback: true,
    requireApiKey: true,
  });

  assert.equal(productionBlocked.ok, false);
  assert.equal(productionBlocked.code, "DAILY_CONFIG_BLOCKED");
  assert.equal(productionBlocked.dailyDomain, DAILY_DOMAIN);
  assert.equal(productionBlocked.fallbackUsed, false);
  assert.deepEqual(productionBlocked.blockers, [
    "daily_domain_missing",
    "daily_domain_fallback_blocked",
  ]);

  const localAllowed = resolveDailyRuntimeConfig({
    dailyApiKey: "daily_local_key_present",
    dailyDomainEnv: "",
    environment: "local",
    allowLocalFallback: true,
    requireApiKey: true,
  });

  assert.deepEqual(localAllowed, {
    ok: true,
    code: "OK",
    dailyApiKey: "daily_local_key_present",
    dailyDomain: DAILY_DOMAIN,
    dailyDomainEnv: null,
    fallbackUsed: true,
    blockers: [],
  });
});

test("participant tokens are scoped to the same canonical room but distinct users", () => {
  const userA = buildMeetingTokenProperties({
    roomName: ROOM_NAME,
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ttlSeconds: 120,
    nowSeconds: 1_000,
  });
  const userB = buildMeetingTokenProperties({
    roomName: ROOM_NAME,
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ttlSeconds: 120,
    nowSeconds: 1_000,
  });

  assert.equal(userA.room_name, ROOM_NAME);
  assert.equal(userB.room_name, ROOM_NAME);
  assert.notEqual(userA.user_id, userB.user_id);
  assert.equal(userA.exp, 1_120);
  assert.equal(userB.exp, 1_120);
  assert.equal(userA.eject_at_token_exp, undefined);
});

test("meeting tokens can opt into provider eject at token expiry", () => {
  const token = buildMeetingTokenProperties({
    roomName: ROOM_NAME,
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ttlSeconds: 120,
    nowSeconds: 1_000,
    ejectAtTokenExp: true,
  });

  assert.equal(token.eject_at_token_exp, true);
});

test("video-date provider room properties are private, finite, and two-person only", () => {
  assert.deepEqual(buildVideoDateRoomProperties({ nowSeconds: 1_000, ttlSeconds: 120 }), {
    max_participants: 2,
    enable_chat: false,
    enable_screenshare: false,
    enable_recording: false,
    enable_knocking: false,
    enforce_unique_user_ids: true,
    start_video_off: false,
    start_audio_off: false,
    exp: 1_120,
    eject_at_room_exp: true,
  });
});

test("Daily provider already-exists errors are treated as idempotent room creation success", () => {
  assert.equal(isDailyRoomAlreadyExistsErrorText("room already exists"), true);
  assert.equal(isDailyRoomAlreadyExistsErrorText("Bad request: ROOM ALREADY EXISTS"), true);
  assert.equal(isDailyRoomAlreadyExistsErrorText("invalid room name"), false);
});

test("missing or expired provider rooms are planned for same-name recovery", () => {
  assert.deepEqual(planDailyProviderRoomRecovery({ exists: true, expired: false }), {
    shouldCreate: false,
    shouldDeleteExpired: false,
    providerRoomRecreated: false,
    providerRoomRecovered: false,
    reason: "exists",
  });
  assert.deepEqual(planDailyProviderRoomRecovery({ exists: false, expired: false }), {
    shouldCreate: true,
    shouldDeleteExpired: false,
    providerRoomRecreated: true,
    providerRoomRecovered: true,
    reason: "missing",
  });
  assert.deepEqual(planDailyProviderRoomRecovery({ exists: true, expired: true }), {
    shouldCreate: true,
    shouldDeleteExpired: true,
    providerRoomRecreated: true,
    providerRoomRecovered: true,
    reason: "expired",
  });
});

test("delete_room safety delegates video-date room deletion to cron", () => {
  assert.deepEqual(
    classifyDeleteRoomSafety({
      roomType: "video_date",
      endedAt: null,
      state: "handshake",
      phase: "handshake",
    }),
    {
      shouldDelete: false,
      code: "VIDEO_DATE_CLEANUP_OWNED_BY_CRON",
      outcome: "skipped_peer_joining",
    },
  );
  assert.deepEqual(
    classifyDeleteRoomSafety({
      roomType: "video_date",
      endedAt: "2026-04-29T01:00:00.000Z",
    }),
    {
      shouldDelete: false,
      code: "VIDEO_DATE_CLEANUP_OWNED_BY_CRON",
      outcome: "skipped_active_session",
    },
  );
});
