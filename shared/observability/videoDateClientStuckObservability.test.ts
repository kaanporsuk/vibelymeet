import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_DATE_CLIENT_STUCK_EVENT_NAMES,
  buildVideoDateClientStuckPayload,
  clearVideoDateClientStuckObservabilityDedupeForTests,
  emitVideoDateClientStuckObservability,
  sanitizeVideoDateClientStuckPayload,
} from "./videoDateClientStuckObservability";

test("client stuck observability event allowlist stays sparse", () => {
  assert.deepEqual(VIDEO_DATE_CLIENT_STUCK_EVENT_NAMES, [
    "ready_gate_handoff_slow",
    "prepare_date_entry_failed",
    "daily_join_confirmation_failed",
    "peer_missing_terminal",
    "peer_missing_suppressed_remote_seen",
    "peer_missing_suppressed_survey_truth",
    "daily_call_cleanup",
    "daily_call_singleton_idle_destroy",
    "daily_call_reuse",
    "daily_call_busy_internal_retry",
    "daily_call_busy_exhausted",
    "remote_seen_canonical_repair_failed",
    "daily_owner_provider_left_unexpected",
    "native_background_recovery_started",
    "native_background_recovery_failed",
    "native_background_expired",
  ]);
});

test("client stuck payload builder emits constrained keys and latency buckets", () => {
  assert.deepEqual(
    buildVideoDateClientStuckPayload({
      platform: "web",
      sourceSurface: "ready_gate_overlay",
      sourceAction: "prepare_entry_failed_no_nav",
      reasonCode: "DAILY_PROVIDER_ERROR",
      latencyMs: 12_345,
      extra: {
        attempt_count: 3,
        retryable: true,
        exhausted: true,
        entry_attempt_id: "vdt_abc-123",
      },
    }),
    {
      platform: "web",
      source_surface: "ready_gate_overlay",
      source_action: "prepare_entry_failed_no_nav",
      reason_code: "DAILY_PROVIDER_ERROR",
      duration_ms: 12345,
      latency_bucket: "5_15s",
      attempt_count: 3,
      retryable: true,
      exhausted: true,
      entry_attempt_id: "vdt_abc-123",
    },
  );
});

test("client stuck payload sanitizer drops sensitive and free-form values", () => {
  assert.deepEqual(
    sanitizeVideoDateClientStuckPayload({
      platform: "native",
      token: "secret",
      room_url: "https://example.daily.co/private",
      source_surface: "video_date_daily",
      source_action: "daily_join_confirmation",
      reason_code: "daily_join_failed",
      freeform: "my email is user@example.com",
      code: "Bearer abc",
      entry_attempt_id: "attempt:1_ok",
      daily_start_attempt_id: "start-1",
      video_date_trace_id: "trace-1",
      room_name: "date-8b1e4e8c21414c33b978a751d37e4c9b",
      owner_id: "vde_owner_1",
      owner_state: "joined",
      provider_session_id: "daily-provider-session-1",
      previous_session_id: "8b1e4e8c-2141-4c33-b978-a751d37e4c9b",
      previous_room_name: "date-8b1e4e8c21414c33b978a751d37e4c9b",
      caller: "startCall",
      meeting_state: "joined-meeting",
      cleanup_reason: "same_session_rebuild",
      duration_ms: Number.POSITIVE_INFINITY,
      elapsed_ms: 900,
      http_status: 503,
      attempt_count: 200,
      retryable: false,
      leave_called: true,
      destroy_called: false,
      reused: true,
      same_session_daily_continuity: true,
      same_session_daily_continuity_latched: true,
      daily_call_singleton_eligible: true,
      will_park_singleton: true,
      parked_singleton: true,
      singleton_parking_mode: "live_same_session_remount",
      idle_ms: 20000,
      idle_age_ms: 20001,
      idle_destroy_disabled: false,
      active_call_session_id_matches: true,
      route_owned: true,
      call_object_present: true,
      truth_refresh_attempt: 2,
      historical_remote_seen_truth: true,
    }),
    {
      platform: "native",
      source_surface: "video_date_daily",
      source_action: "daily_join_confirmation",
      reason_code: "daily_join_failed",
      entry_attempt_id: "attempt:1_ok",
      daily_start_attempt_id: "start-1",
      video_date_trace_id: "trace-1",
      room_name: "date-8b1e4e8c21414c33b978a751d37e4c9b",
      owner_id: "vde_owner_1",
      owner_state: "joined",
      provider_session_id: "daily-provider-session-1",
      previous_session_id: "8b1e4e8c-2141-4c33-b978-a751d37e4c9b",
      previous_room_name: "date-8b1e4e8c21414c33b978a751d37e4c9b",
      caller: "startCall",
      meeting_state: "joined-meeting",
      cleanup_reason: "same_session_rebuild",
      elapsed_ms: 900,
      http_status: 503,
      attempt_count: 100,
      retryable: false,
      leave_called: true,
      destroy_called: false,
      reused: true,
      same_session_daily_continuity: true,
      same_session_daily_continuity_latched: true,
      daily_call_singleton_eligible: true,
      will_park_singleton: true,
      parked_singleton: true,
      singleton_parking_mode: "live_same_session_remount",
      idle_ms: 20000,
      idle_age_ms: 20001,
      idle_destroy_disabled: false,
      active_call_session_id_matches: true,
      route_owned: true,
      call_object_present: true,
      truth_refresh_attempt: 2,
      historical_remote_seen_truth: true,
    },
  );
});

test("client stuck emitter rejects unknown events and dedupes per session event", async () => {
  clearVideoDateClientStuckObservabilityDedupeForTests();
  const calls: unknown[] = [];
  const client = {
    rpc: async (_fn: "record_video_date_client_stuck_observability", args: Record<string, unknown>) => {
      calls.push(args);
      return { data: { ok: true, inserted: true }, error: null };
    },
  };

  assert.deepEqual(
    await emitVideoDateClientStuckObservability({
      client,
      sessionId: "8b1e4e8c-2141-4c33-b978-a751d37e4c9b",
      eventName: "unknown_event" as never,
    }),
    { ok: false, skipped: true, reason: "unknown_event_name" },
  );

  const first = await emitVideoDateClientStuckObservability({
    client,
    sessionId: "8b1e4e8c-2141-4c33-b978-a751d37e4c9b",
    eventName: "peer_missing_terminal",
    payload: { platform: "web", source_surface: "video_date_daily" },
    latencyMs: 25_000,
  });
  assert.equal(first.ok, true);

  assert.deepEqual(
    await emitVideoDateClientStuckObservability({
      client,
      sessionId: "8b1e4e8c-2141-4c33-b978-a751d37e4c9b",
      eventName: "peer_missing_terminal",
    }),
    { ok: false, skipped: true, reason: "deduped" },
  );
  assert.equal(calls.length, 1);

  const appendOnlyFirst = await emitVideoDateClientStuckObservability({
    client,
    sessionId: "8b1e4e8c-2141-4c33-b978-a751d37e4c9b",
    eventName: "daily_call_cleanup",
    payload: { platform: "web", source_surface: "video_date_daily", caller: "startCall" },
    dedupe: false,
  });
  const appendOnlySecond = await emitVideoDateClientStuckObservability({
    client,
    sessionId: "8b1e4e8c-2141-4c33-b978-a751d37e4c9b",
    eventName: "daily_call_cleanup",
    payload: { platform: "web", source_surface: "video_date_daily", caller: "startCall" },
    dedupe: false,
  });
  assert.equal(appendOnlyFirst.ok, true);
  assert.equal(appendOnlySecond.ok, true);
  assert.equal(calls.length, 3);
});
