/**
 * Shared types for draft media sessions (Phase 2).
 *
 * draft_media_sessions tracks the full lifecycle of media uploads for both
 * onboarding and Profile Studio flows. These types are shared across web,
 * native, and backend.
 */

// ─── Status state machine ────────────────────────────────────────────────────
//
// created → uploading → processing → ready → published
//                    ↘ failed                ↘ deleted
//                    ↘ abandoned (cleanup)

export const MEDIA_SESSION_STATUSES = [
  "created",
  "uploading",
  "processing",
  "ready",
  "failed",
  "published",
  "abandoned",
  "deleted",
] as const;

export type MediaSessionStatus = (typeof MEDIA_SESSION_STATUSES)[number];

export const MEDIA_SESSION_ACTIVE_STATUSES: readonly MediaSessionStatus[] = [
  "created",
  "uploading",
  "processing",
  "ready",
];

export const MEDIA_SESSION_TERMINAL_STATUSES: readonly MediaSessionStatus[] = [
  "published",
  "deleted",
  "abandoned",
  "failed",
];

// ─── Media types ─────────────────────────────────────────────────────────────

export const MEDIA_TYPES = ["vibe_video", "photo"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

// ─── Contexts ────────────────────────────────────────────────────────────────

export const MEDIA_CONTEXTS = ["onboarding", "profile_studio"] as const;
export type MediaContext = (typeof MEDIA_CONTEXTS)[number];

// ─── Session shape (matches DB row) ──────────────────────────────────────────

export interface MediaSession {
  id: string;
  user_id: string;
  media_type: MediaType;
  status: MediaSessionStatus;
  provider: "bunny";
  provider_id: string | null;
  provider_meta: Record<string, unknown>;
  context: MediaContext;
  storage_path: string | null;
  caption: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  expires_at: string;
}

// ─── RPC request/response shapes ─────────────────────────────────────────────

export interface CreateMediaSessionResult {
  success: boolean;
  session_id?: string;
  replaced_session_id?: string | null;
  replaced_provider_id?: string | null;
  error?: string;
}

export interface UpdateMediaSessionStatusResult {
  success: boolean;
  session_id?: string;
  user_id?: string;
  previous_status?: MediaSessionStatus;
  new_status?: MediaSessionStatus;
  error?: string;
}

export interface PublishMediaSessionResult {
  success: boolean;
  session_id?: string;
  published?: boolean;
  already_published?: boolean;
  error?: string;
  current_status?: MediaSessionStatus;
}

export interface GetActiveMediaSessionResult {
  success: boolean;
  session?: {
    id: string;
    status: MediaSessionStatus;
    provider_id: string | null;
    provider_meta: Record<string, unknown>;
    context: MediaContext;
    storage_path: string | null;
    caption: string | null;
    created_at: string;
    expires_at: string;
  } | null;
  error?: string;
}

// ─── Vibe video credential shape (returned by create-video-upload) ───────────

export interface VibeVideoUploadCredentials {
  videoId: string;
  libraryId: number;
  expirationTime: number;
  signature: string;
  cdnHostname: string | undefined;
  sessionId: string | null;
}

// ─── Photo session shape (Phase 2B placeholder) ─────────────────────────────

export interface PhotoUploadResult {
  path: string;
  sessionId: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isActiveStatus(status: MediaSessionStatus): boolean {
  return (MEDIA_SESSION_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isTerminalStatus(status: MediaSessionStatus): boolean {
  return (MEDIA_SESSION_TERMINAL_STATUSES as readonly string[]).includes(status);
}
