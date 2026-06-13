import { supabase } from '@/lib/supabase';

// Native date-route counterpart to src/lib/videoDateSessionRow.ts. This is the
// single owner for hot /date video_sessions row reads; terminal survey and
// narrow partner/icebreaker queries stay explicit where they need smaller
// projections.
export const VIDEO_DATE_SESSION_ROW_COLUMNS = [
  'id',
  'event_id',
  'participant_1_id',
  'participant_2_id',
  'session_seq',
  'state',
  'phase',
  'ended_at',
  'ended_reason',
  'entry_started_at',
  'entry_grace_expires_at',
  'date_started_at',
  'date_extra_seconds',
  'ready_gate_status',
  'ready_gate_expires_at',
  'daily_room_name',
  'daily_room_url',
  'participant_1_joined_at',
  'participant_2_joined_at',
  'participant_1_remote_seen_at',
  'participant_2_remote_seen_at',
  'participant_1_liked',
  'participant_2_liked',
  'participant_1_decided_at',
  'participant_2_decided_at',
  'vibe_questions',
  'vibe_question_index',
  'vibe_question_anchor_at',
].join(', ');

export type VideoDateSessionRowData = {
  id: string;
  event_id: string | null;
  participant_1_id: string;
  participant_2_id: string;
  session_seq?: number | null;
  state?: string | null;
  phase?: string | null;
  ended_at: string | null;
  ended_reason?: string | null;
  entry_started_at: string | null;
  entry_grace_expires_at?: string | null;
  date_started_at?: string | null;
  date_extra_seconds?: number | null;
  ready_gate_status?: string | null;
  ready_gate_expires_at?: string | number | null;
  daily_room_name: string | null;
  daily_room_url: string | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  participant_1_remote_seen_at?: string | null;
  participant_2_remote_seen_at?: string | null;
  participant_1_liked?: boolean | null;
  participant_2_liked?: boolean | null;
  participant_1_decided_at?: string | null;
  participant_2_decided_at?: string | null;
  vibe_questions?: unknown;
  vibe_question_index?: number | null;
  vibe_question_anchor_at?: string | null;
};

export type VideoDateSessionRowResult = {
  data: VideoDateSessionRowData | null;
  error: { code?: string; message: string; details?: string | null; hint?: string | null } | null;
};

const SESSION_ROW_REUSE_MS = 300;
const rowInFlight = new Map<string, Promise<VideoDateSessionRowResult>>();
const rowRecent = new Map<string, { at: number; result: VideoDateSessionRowResult }>();

export async function fetchVideoDateSessionRow(
  sessionId: string,
  options?: { fresh?: boolean },
): Promise<VideoDateSessionRowResult> {
  const freshKey = `${sessionId}:fresh`;
  const defaultKey = `${sessionId}:default`;

  if (!options?.fresh) {
    const recent = rowRecent.get(sessionId);
    if (recent && Date.now() - recent.at <= SESSION_ROW_REUSE_MS) {
      return recent.result;
    }

    const existingFresh = rowInFlight.get(freshKey);
    if (existingFresh) return existingFresh;
  }

  const inFlightKey = options?.fresh ? freshKey : defaultKey;
  const existing = rowInFlight.get(inFlightKey);
  if (existing) return existing;

  const request = (async (): Promise<VideoDateSessionRowResult> => {
    // Stamp the cache entry with the time the read was issued, not the time it
    // resolved. An older default read that started before a fresh recovery read
    // must never overwrite the post-terminal row that the fresh read cached
    // (review P2 on PR #1299): a default and fresh request can now run
    // concurrently (split in-flight keys), and the default one can finish last.
    const startedAt = Date.now();
    const { data, error } = await supabase
      .from('video_sessions')
      .select(VIDEO_DATE_SESSION_ROW_COLUMNS)
      .eq('id', sessionId)
      .maybeSingle();
    const result: VideoDateSessionRowResult = {
      data: (data as VideoDateSessionRowData | null) ?? null,
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
      const existing = rowRecent.get(sessionId);
      if (!existing || existing.at <= startedAt) {
        rowRecent.set(sessionId, { at: startedAt, result });
        if (rowRecent.size > 8) {
          const oldest = rowRecent.keys().next().value;
          if (oldest !== undefined) rowRecent.delete(oldest);
        }
      }
    }
    return result;
  })();

  rowInFlight.set(inFlightKey, request);
  try {
    return await request;
  } finally {
    if (rowInFlight.get(inFlightKey) === request) rowInFlight.delete(inFlightKey);
  }
}
