/**
 * Ensures only one chat voice message plays at a time.
 *
 * Each VoiceMessagePlayer holds its own expo-audio player instance; without coordination,
 * tapping a second voice note would play it on top of the first. When a player starts, it
 * registers here and the previously-active player is paused.
 */

type VoicePlaybackHandle = {
  /** Stable per-player-instance key. */
  id: string;
  /** Pauses this player. Must not throw. */
  pause: () => void;
};

let activeHandle: VoicePlaybackHandle | null = null;

/** Register a player as the active one, pausing whichever was playing before. */
export function startVoicePlayback(handle: VoicePlaybackHandle): void {
  if (activeHandle && activeHandle.id !== handle.id) {
    try {
      activeHandle.pause();
    } catch {
      // pause is expected to be self-guarding; ignore anything that slips through.
    }
  }
  activeHandle = handle;
}

/** Clear the active registration if `id` still owns it (no-op once superseded). */
export function endVoicePlayback(id: string): void {
  if (activeHandle && activeHandle.id === id) {
    activeHandle = null;
  }
}
