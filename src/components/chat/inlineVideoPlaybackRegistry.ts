// Coordinates inline chat clip playback so that only one in-thread bubble video
// plays at a time. Both VideoMessageBubble and VibeClipBubble register their
// <video> element when it starts playing; claiming pauses whichever element was
// previously active. This mirrors the single-active behavior of native chat
// clips and prevents overlapping audio when a user taps a second clip while the
// first is still playing.
//
// Intentionally a tiny module-level singleton with no React state: it must work
// across independently-rendered bubbles (and across chat threads) without any
// shared provider, and pausing is a side-effect, not rendered UI.

let activeInlineVideoEl: HTMLVideoElement | null = null;

/**
 * Mark `el` as the active inline video, pausing the previously active element if
 * it is a different, still-playing video. Safe to call repeatedly for the same
 * element. The `paused` guard makes this a no-op for detached/ended elements, so
 * a stale reference can never wrongly pause a freshly-started clip.
 */
export function claimInlineVideoPlayback(el: HTMLVideoElement | null): void {
  if (!el) return;
  if (activeInlineVideoEl && activeInlineVideoEl !== el && !activeInlineVideoEl.paused) {
    try {
      activeInlineVideoEl.pause();
    } catch {
      // Pausing a detached element can throw in rare cases; the registry is
      // best-effort, so swallow it.
    }
  }
  activeInlineVideoEl = el;
}

/** Release `el` if it is the active element (e.g. on ended/unmount). */
export function releaseInlineVideoPlayback(el: HTMLVideoElement | null): void {
  if (el && activeInlineVideoEl === el) {
    activeInlineVideoEl = null;
  }
}
