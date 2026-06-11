import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

// Golden-flow lean pass: the /date mount path read the same video_sessions row
// through 6 independent queries with 5 different select shapes
// (SessionRouteHydration, VideoDate mount log, VideoDate access guard,
// VideoDate entry refresh, useVideoCall truth fetch, IceBreakerCard).
// This module is the single owner of the date-path session-row projection:
// one canonical superset select, concurrent callers share one in-flight
// request, and a result is reused for 300ms (below every caller's
// poll/refresh cadence). Errors are never memoized; the PostgREST error
// object passes through unchanged so caller semantics are untouched.

export const VIDEO_DATE_SESSION_ROW_COLUMNS = [
  "id",
  "event_id",
  "participant_1_id",
  "participant_2_id",
  "session_seq",
  "state",
  "phase",
  "ended_at",
  "ended_reason",
  "entry_started_at",
  "entry_grace_expires_at",
  "date_started_at",
  "date_extra_seconds",
  "ready_gate_status",
  "ready_gate_expires_at",
  "daily_room_name",
  "daily_room_url",
  "participant_1_joined_at",
  "participant_2_joined_at",
  "participant_1_remote_seen_at",
  "participant_2_remote_seen_at",
  "participant_1_liked",
  "participant_2_liked",
  "participant_1_decided_at",
  "participant_2_decided_at",
  "vibe_questions",
  "vibe_question_index",
  "vibe_question_anchor_at",
].join(", ");

type VideoSessionsRow = Database["public"]["Tables"]["video_sessions"]["Row"];

// The canonical projection, typed straight from the generated schema so every
// caller sees exactly the types the literal selects used to infer.
export type VideoDateSessionRowData = Pick<
  VideoSessionsRow,
  | "id"
  | "event_id"
  | "participant_1_id"
  | "participant_2_id"
  | "session_seq"
  | "state"
  | "phase"
  | "ended_at"
  | "ended_reason"
  | "entry_started_at"
  | "entry_grace_expires_at"
  | "date_started_at"
  | "date_extra_seconds"
  | "ready_gate_status"
  | "ready_gate_expires_at"
  | "daily_room_name"
  | "daily_room_url"
  | "participant_1_joined_at"
  | "participant_2_joined_at"
  | "participant_1_remote_seen_at"
  | "participant_2_remote_seen_at"
  | "participant_1_liked"
  | "participant_2_liked"
  | "participant_1_decided_at"
  | "participant_2_decided_at"
  | "vibe_questions"
  | "vibe_question_index"
  | "vibe_question_anchor_at"
>;

export type VideoDateSessionRowResult = {
  data: VideoDateSessionRowData | null;
  error: { code?: string; message: string; details?: string | null; hint?: string | null } | null;
};

const SESSION_ROW_REUSE_MS = 300;
const rowInFlight = new Map<string, Promise<VideoDateSessionRowResult>>();
const rowRecent = new Map<string, { at: number; result: VideoDateSessionRowResult }>();

// options.fresh bypasses the 300ms reuse window for one-shot terminal/recovery
// truth reads (review P2 on PR #1292): a recovery decision must never act on a
// pre-terminal row another mount-path reader cached moments earlier. Fresh
// reads still coalesce with an in-flight request (it is hitting the DB now)
// and refresh the memo for mount-path readers.
export async function fetchVideoDateSessionRow(
  sessionId: string,
  options?: { fresh?: boolean },
): Promise<VideoDateSessionRowResult> {
  if (!options?.fresh) {
    const recent = rowRecent.get(sessionId);
    if (recent && Date.now() - recent.at <= SESSION_ROW_REUSE_MS) {
      return recent.result;
    }
  }

  const existing = rowInFlight.get(sessionId);
  if (existing) return existing;

  const request = (async (): Promise<VideoDateSessionRowResult> => {
    const { data, error } = await supabase
      .from("video_sessions")
      .select(VIDEO_DATE_SESSION_ROW_COLUMNS)
      .eq("id", sessionId)
      .maybeSingle();
    const result: VideoDateSessionRowResult = {
      data: (data as unknown as VideoDateSessionRowData | null) ?? null,
      error: error
        ? {
            code: error.code ?? undefined,
            message: error.message,
            details: error.details ?? null,
            hint: error.hint ?? null,
          }
        : null,
    };
    if (!error) {
      rowRecent.set(sessionId, { at: Date.now(), result });
      if (rowRecent.size > 8) {
        const oldest = rowRecent.keys().next().value;
        if (oldest !== undefined) rowRecent.delete(oldest);
      }
    }
    return result;
  })();

  rowInFlight.set(sessionId, request);
  try {
    return await request;
  } finally {
    if (rowInFlight.get(sessionId) === request) rowInFlight.delete(sessionId);
  }
}
