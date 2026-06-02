export const ENSURE_VIDEO_DATE_ROOM_ACTION = "ensure_date_room" as const;

export type VideoDateRoomWarmupTimings = {
  auth_ms?: number | null;
  session_fetch_ms?: number | null;
  room_create_or_verify_ms?: number | null;
  total_ms?: number | null;
  response_ready_ms?: number | null;
  [key: string]: number | null | undefined;
};

export type VideoDateRoomWarmupSuccess = {
  success: true;
  room_name: string;
  room_url: string;
  reused_room?: boolean;
  provider_room_recreated?: boolean;
  provider_room_recovered?: boolean;
  provider_verify_skipped?: boolean;
  provider_verify_reason?: string | null;
  daily_room_verified_at?: string | null;
  daily_room_expires_at?: string | null;
  entry_attempt_id?: string | null;
  video_date_trace_id?: string | null;
  timings?: VideoDateRoomWarmupTimings;
};

export type VideoDateRoomWarmupFailure = {
  success?: false;
  code?: string;
  error?: string;
  message?: string;
  httpStatus?: number;
  retryable?: boolean;
  retry_after_seconds?: number;
  retryAfterSeconds?: number;
  retry_after_ms?: number;
  retryAfterMs?: number;
};

export type VideoDateRoomWarmupResult =
  | {
      ok: true;
      data: VideoDateRoomWarmupSuccess;
      coalesced?: boolean;
      ownerEntryAttemptId?: string | null;
    }
  | {
      ok: false;
      code: string;
      message?: string;
      httpStatus?: number;
      retryable: boolean;
      entryAttemptId?: string | null;
      retryAfterSeconds?: number;
      retryAfterMs?: number;
      coalesced?: boolean;
      ownerEntryAttemptId?: string | null;
    };

export function hasVideoDateRoomWarmupPayload(
  data: unknown,
): data is VideoDateRoomWarmupSuccess {
  if (!data || typeof data !== "object") return false;
  const row = data as Partial<VideoDateRoomWarmupSuccess>;
  return (
    row.success === true &&
    typeof row.room_name === "string" &&
    typeof row.room_url === "string"
  );
}

export function readVideoDateRoomWarmupFailureMessage(
  data: unknown,
  fallback?: string,
): string | undefined {
  if (!data || typeof data !== "object") return fallback;
  const row = data as { error?: unknown; message?: unknown };
  return typeof row.message === "string"
    ? row.message
    : typeof row.error === "string"
      ? row.error
      : fallback;
}
