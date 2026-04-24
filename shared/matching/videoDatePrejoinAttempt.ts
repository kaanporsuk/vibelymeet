export type PrejoinAttemptStep =
  | "effect_started"
  | "initial_state"
  | "permissions"
  | "truth_fetch"
  | "handshake_guard"
  | "enter_handshake"
  | "refetch_video_session"
  | "daily_room_truth_guard"
  | "daily_room_guard"
  | "daily_room"
  | "daily_join";

export function shouldPreservePrejoinAttemptOnCleanup(step: PrejoinAttemptStep): boolean {
  return (
    step === "enter_handshake" ||
    step === "refetch_video_session" ||
    step === "daily_room_truth_guard" ||
    step === "daily_room_guard" ||
    step === "daily_room" ||
    step === "daily_join"
  );
}
