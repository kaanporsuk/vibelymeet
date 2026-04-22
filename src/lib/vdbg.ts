import * as Sentry from "@sentry/react";

/**
 * Temporary diagnostics (web dev only): JSON-stringify selected VDBG payloads for Chrome console
 * copy/paste during video-date investigation — avoids collapsed `Object` previews for nested `row` data.
 * Remove or narrow once investigation ends.
 */
const VDBG_VIDEO_DATE_DEV_CONSOLE_JSON = new Set<string>([
  "lobby_mount_active_session",
  "lobby_navigate_to_date",
  "lobby_mount_active_session_detail",
  "ready_gate_open",
  "date_mount",
  "date_mount_session_row",
  "date_guard_session_row",
  "date_guard_ready_gate_stale_registration_ignored",
  "route_hydration_date_guard",
  "route_hydration_ready_gate_bounce_blocked",
  "route_hydration_ready_gate_bounce",
  "sync_reconnect_fire",
  "sync_reconnect_schedule",
  "sync_reconnect_skip",
  "sync_reconnect_result",
  "sync_reconnect_loop_stop",
  "video_date_transition_before",
  "video_date_transition_after",
  "video_date_transition_skipped",
  "daily_call_reuse_decision",
  "date_prejoin_truth_row",
  "daily_room_before",
  "daily_room_after",
  "daily_call_object_created",
  "daily_join_start",
  "daily_join_success",
  "mark_video_date_daily_joined_before",
  "mark_video_date_daily_joined_after",
  "daily_no_remote_watchdog_start",
  "daily_no_remote_watchdog_timeout",
  "daily_no_remote_watchdog_recovery",
  "date_entry_latch_cleared",
  "first_remote_participant_seen",
  "daily_remote_tracks_changed",
  "daily_remote_track_mounted",
  "daily_local_track_mounted",
  "daily_call_cleanup_start",
  "daily_call_leave_before",
  "daily_call_leave_after",
  "daily_call_left_meeting",
  "daily_call_destroy",
  "daily_room_delete_skipped",
  "post_date_survey_opened",
  "journey_date_route_entered",
  "journey_survey_opened",
  "date_redirect",
]);

function devConsoleShouldJsonStringify(message: string): boolean {
  if (VDBG_VIDEO_DATE_DEV_CONSOLE_JSON.has(message)) return true;
  // EventLobby `logVdbgSessionStage` emits `${base}_stage` (e.g. lobby_navigate_to_date_stage).
  if (message.endsWith("_stage")) return true;
  // journey_* from VideoDate / PostDateSurvey (`journey_${event}`).
  if (message.startsWith("journey_")) return true;
  return false;
}

/** Best-effort JSON for console; handles typical circular refs in devtools mirrors without throwing. */
function stringifyPayloadForDevConsole(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch {
    try {
      const seen = new WeakSet<object>();
      return JSON.stringify(payload, (_key, val) => {
        if (val !== null && typeof val === "object") {
          if (seen.has(val as object)) return "[Circular]";
          seen.add(val as object);
        }
        return val as unknown;
      });
    } catch {
      return "[VDBG payload: unserializable]";
    }
  }
}

export function vdbg(message: string, data?: Record<string, unknown>): void {
  const payload = { ...(data ?? {}), ts: new Date().toISOString() };
  if (import.meta.env.DEV && devConsoleShouldJsonStringify(message)) {
    console.log(`[VDBG] ${message}`, stringifyPayloadForDevConsole(payload));
  } else {
    console.log(`[VDBG] ${message}`, payload);
  }
  Sentry.addBreadcrumb({
    category: "vdbg",
    message,
    level: "info",
    data: payload,
  });
}
