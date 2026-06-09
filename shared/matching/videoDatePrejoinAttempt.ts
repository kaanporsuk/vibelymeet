export type PrejoinAttemptStep =
  | "effect_started"
  | "initial_state"
  | "permissions"
  | "truth_fetch"
  | "handshake_guard"
  | "prepare_entry_routeable"
  | "refetch_video_session"
  | "daily_room_truth_guard"
  | "surface_claim"
  | "daily_room_guard"
  | "daily_room"
  | "daily_join";

export function shouldPreservePrejoinAttemptOnCleanup(step: PrejoinAttemptStep): boolean {
  return (
    step === "truth_fetch" ||
    step === "prepare_entry_routeable" ||
    step === "refetch_video_session" ||
    step === "daily_room_truth_guard" ||
    step === "surface_claim" ||
    step === "daily_room_guard" ||
    step === "daily_room" ||
    step === "daily_join"
  );
}
