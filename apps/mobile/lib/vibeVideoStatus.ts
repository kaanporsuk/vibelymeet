/**
 * Native re-export for shared Bunny `bunny_video_status` normalization.
 * Keep imports through this file in native code so older call sites continue to
 * share the exact web/native semantics.
 */
export {
  normalizeBunnyVideoStatus,
  type BunnyVideoStatusNormalized,
} from '@clientShared/vibeVideoSemantics';
