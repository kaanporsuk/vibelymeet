const REBUFFER_DEGRADE_WINDOW_MS = 30_000;
const REBUFFER_DEGRADE_THRESHOLD = 2;

let qoeDegraded = false;
const recentRebufferEvents: number[] = [];

export function recordMediaPlaybackRebuffer(nowMs = Date.now()): boolean {
  recentRebufferEvents.push(nowMs);
  while (recentRebufferEvents.length && recentRebufferEvents[0] < nowMs - REBUFFER_DEGRADE_WINDOW_MS) {
    recentRebufferEvents.shift();
  }
  if (recentRebufferEvents.length > REBUFFER_DEGRADE_THRESHOLD) qoeDegraded = true;
  return qoeDegraded;
}

export function isMediaPlaybackQoeDegraded(): boolean {
  return qoeDegraded;
}

