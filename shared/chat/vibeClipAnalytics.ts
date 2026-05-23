/**
 * Canonical PostHog event names + shared metadata helpers for the Vibe Clip funnel.
 * No PII — match ids and message ids are not sent (use buckets only).
 */

import { VIBE_CLIP_THREAD_WARM_THRESHOLD } from './vibeClipPrompts';
import { MEDIA_VIBE_CLIP_EVENTS } from '../media/mediaTelemetry';

/** Stable snake_case event names (PostHog). */
export const VIBE_CLIP_EVENTS = MEDIA_VIBE_CLIP_EVENTS;

export type VibeClipEventName = (typeof VIBE_CLIP_EVENTS)[keyof typeof VIBE_CLIP_EVENTS];

export type ThreadBucket = 'cold' | 'warm';

export function threadBucketFromCount(messageCount: number): ThreadBucket {
  return messageCount >= VIBE_CLIP_THREAD_WARM_THRESHOLD ? 'warm' : 'cold';
}

/** Coarse duration buckets aligned with 30s product cap. */
export type DurationBucket = '0_10s' | '10_20s' | '20_30s' | 'unknown';

export function durationBucketFromSeconds(sec: number | null | undefined): DurationBucket {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return 'unknown';
  if (sec <= 10) return '0_10s';
  if (sec <= 20) return '10_20s';
  if (sec <= 30) return '20_30s';
  return '20_30s';
}

export type FailureClass = 'upload' | 'publish' | 'permission' | 'network' | 'unknown';

export function classifySendFailureMessage(msg: string): FailureClass {
  const m = msg.toLowerCase();
  if (m.includes('network') || m.includes('offline') || m.includes('timeout')) return 'network';
  if (m.includes('permission') || m.includes('denied')) return 'permission';
  if (m.includes('upload')) return 'upload';
  if (m.includes('publish') || m.includes('invoke') || m.includes('edge')) return 'publish';
  return 'unknown';
}

export type CaptureSource = 'camera' | 'library' | 'web_recorder';

export type LaunchedFrom = 'chat' | 'clip_context';
