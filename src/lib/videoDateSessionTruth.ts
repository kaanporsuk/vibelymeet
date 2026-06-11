import { supabase } from "@/integrations/supabase/client";
import { fetchVideoDateStartSnapshot } from "@/lib/videoDateStartSnapshot";
import { videoDateStartSnapshotToDateEntryTruth } from "@clientShared/matching/videoDateStartSnapshot";

export type VideoSessionDateEntryTruth = {
  event_id: string | null;
  participant_1_id: string | null;
  participant_2_id: string | null;
  ended_at: string | null;
  ended_reason?: string | null;
  state: string | null;
  phase: string | null;
  ready_gate_status: string | null;
  ready_gate_expires_at: string | number | null;
  entry_started_at: string | null;
  date_started_at: string | null;
  daily_room_name: string | null;
  daily_room_url: string | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  participant_1_remote_seen_at?: string | null;
  participant_2_remote_seen_at?: string | null;
};

const truthInflight = new Map<
  string,
  Promise<VideoSessionDateEntryTruth | null | undefined>
>();

export async function fetchVideoSessionDateEntryTruth(
  sessionId: string,
): Promise<VideoSessionDateEntryTruth | null | undefined> {
  const snapshot = await fetchVideoDateStartSnapshot(sessionId);
  const snapshotTruth = videoDateStartSnapshotToDateEntryTruth(snapshot);
  if (snapshotTruth) {
    return snapshotTruth as VideoSessionDateEntryTruth;
  }

  const { data, error } = await supabase
    .from("video_sessions")
    .select(
      "event_id, participant_1_id, participant_2_id, ended_at, ended_reason, state, phase, ready_gate_status, ready_gate_expires_at, entry_started_at, date_started_at, daily_room_name, daily_room_url, participant_1_joined_at, participant_2_joined_at, participant_1_remote_seen_at, participant_2_remote_seen_at",
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (error) return undefined;
  if (!data) return null;
  return data as VideoSessionDateEntryTruth;
}

export async function fetchVideoSessionDateEntryTruthCoalesced(
  sessionId: string,
): Promise<VideoSessionDateEntryTruth | null | undefined> {
  const existing = truthInflight.get(sessionId);
  if (existing) return existing;
  const task = fetchVideoSessionDateEntryTruth(sessionId);
  truthInflight.set(sessionId, task);
  try {
    return await task;
  } finally {
    truthInflight.delete(sessionId);
  }
}
