import { supabase } from "@/integrations/supabase/client";

export type VideoSessionDateEntryTruth = {
  participant_1_id: string | null;
  participant_2_id: string | null;
  ended_at: string | null;
  state: string | null;
  phase: string | null;
  ready_gate_status: string | null;
  ready_gate_expires_at: string | null;
  handshake_started_at: string | null;
  daily_room_name: string | null;
  daily_room_url: string | null;
};

const truthInflight = new Map<
  string,
  Promise<VideoSessionDateEntryTruth | null | undefined>
>();

export async function fetchVideoSessionDateEntryTruth(
  sessionId: string,
): Promise<VideoSessionDateEntryTruth | null | undefined> {
  const { data, error } = await supabase
    .from("video_sessions")
    .select(
      "participant_1_id, participant_2_id, ended_at, state, phase, ready_gate_status, ready_gate_expires_at, handshake_started_at, daily_room_name, daily_room_url",
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
