/**
 * Shared entry-state contract for web + native.
 *
 * The backend RPC is the source of truth. Clients should call resolveEntryState
 * and route off the returned state rather than inferring entry state from
 * profiles.onboarding_complete. Moderation may return `account_suspended` with
 * `route_hint` entry_recovery before the user would otherwise be `complete`,
 * while scheduled account deletion may return `deletion_requested`.
 */

export type EntryState =
  | "complete"
  | "incomplete"
  | "deletion_requested"
  | "missing_profile"
  | "suspected_fragmented_identity"
  | "account_suspended"
  | "hard_error";

export type EntryStateReasonCode =
  | "profile_complete"
  | "profile_incomplete"
  | "profile_incomplete_with_draft"
  | "deletion_requested"
  | "profile_missing"
  | "fragment_verified_phone_match"
  | "fragment_confirmed_email_match"
  | "fragment_verified_email_match"
  | "fragment_multiple_high_confidence_matches"
  | "account_suspended"
  | "auth_required"
  | "auth_user_missing"
  | "resolver_exception";

export type EntryRouteHint = "app" | "onboarding" | "entry_recovery";

export type EntryFragmentMatchBasis =
  | "verified_phone"
  | "confirmed_email"
  | "verified_email";

export type EntryProviderHint = "phone" | "email" | "google" | "apple";

export interface EntryStateDraft {
  exists: boolean;
  current_step: number | null;
  current_stage: string | null;
}

export interface EntryStateCandidateFragment {
  confidence: "high" | "none";
  match_basis: EntryFragmentMatchBasis | null;
  masked_hint: string | null;
  provider_hints: EntryProviderHint[];
}

export interface EntryStateResponse {
  state: EntryState;
  reason_code: EntryStateReasonCode;
  route_hint: EntryRouteHint;
  onboarding_draft: EntryStateDraft;
  candidate_fragment: EntryStateCandidateFragment | null;
  scheduled_deletion_at: string | null;
  retryable: boolean;
  evaluation_version: 1;
}

interface SupabaseRpcClient {
  rpc(fn: string, params?: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

interface AuthLikeUser {
  phone?: string | null;
  app_metadata?: Record<string, unknown> | null;
}

const DEFAULT_DRAFT: EntryStateDraft = {
  exists: false,
  current_step: null,
  current_stage: null,
};

const DEFAULT_EVALUATION_VERSION = 1 as const;

const VALID_STATES = new Set<EntryState>([
  "complete",
  "incomplete",
  "deletion_requested",
  "missing_profile",
  "suspected_fragmented_identity",
  "account_suspended",
  "hard_error",
]);

const VALID_REASON_CODES = new Set<EntryStateReasonCode>([
  "profile_complete",
  "profile_incomplete",
  "profile_incomplete_with_draft",
  "deletion_requested",
  "profile_missing",
  "fragment_verified_phone_match",
  "fragment_confirmed_email_match",
  "fragment_verified_email_match",
  "fragment_multiple_high_confidence_matches",
  "account_suspended",
  "auth_required",
  "auth_user_missing",
  "resolver_exception",
]);

const VALID_ROUTE_HINTS = new Set<EntryRouteHint>([
  "app",
  "onboarding",
  "entry_recovery",
]);

const VALID_MATCH_BASES = new Set<EntryFragmentMatchBasis>([
  "verified_phone",
  "confirmed_email",
  "verified_email",
]);

const VALID_PROVIDER_HINTS = new Set<EntryProviderHint>([
  "phone",
  "email",
  "google",
  "apple",
]);

export function getFallbackEntryState(
  reason_code: EntryStateReasonCode = "resolver_exception",
): EntryStateResponse {
  return {
    state: "hard_error",
    reason_code,
    route_hint: "entry_recovery",
    onboarding_draft: DEFAULT_DRAFT,
    candidate_fragment: null,
    scheduled_deletion_at: null,
    retryable: true,
    evaluation_version: DEFAULT_EVALUATION_VERSION,
  };
}

function asEntryState(value: unknown): EntryState | null {
  return typeof value === "string" && VALID_STATES.has(value as EntryState)
    ? (value as EntryState)
    : null;
}

function asReasonCode(value: unknown): EntryStateReasonCode | null {
  return typeof value === "string" && VALID_REASON_CODES.has(value as EntryStateReasonCode)
    ? (value as EntryStateReasonCode)
    : null;
}

function asRouteHint(value: unknown): EntryRouteHint | null {
  return typeof value === "string" && VALID_ROUTE_HINTS.has(value as EntryRouteHint)
    ? (value as EntryRouteHint)
    : null;
}

function normalizeDraft(value: unknown): EntryStateDraft {
  if (!value || typeof value !== "object") return DEFAULT_DRAFT;
  const record = value as Record<string, unknown>;
  return {
    exists: record.exists === true,
    current_step: typeof record.current_step === "number" ? record.current_step : null,
    current_stage: typeof record.current_stage === "string" ? record.current_stage : null,
  };
}

function normalizeCandidateFragment(value: unknown): EntryStateCandidateFragment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const rawMatchBasis =
    typeof record.match_basis === "string" && VALID_MATCH_BASES.has(record.match_basis as EntryFragmentMatchBasis)
      ? (record.match_basis as EntryFragmentMatchBasis)
      : null;
  const rawProviderHints = Array.isArray(record.provider_hints)
    ? record.provider_hints.filter(
        (provider): provider is EntryProviderHint =>
          typeof provider === "string" && VALID_PROVIDER_HINTS.has(provider as EntryProviderHint),
      )
    : [];

  return {
    confidence: record.confidence === "high" ? "high" : "none",
    match_basis: rawMatchBasis,
    masked_hint: typeof record.masked_hint === "string" ? record.masked_hint : null,
    provider_hints: rawProviderHints,
  };
}

function normalizeScheduledDeletionAt(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function normalizeEntryStateResponse(payload: unknown): EntryStateResponse {
  if (!payload || typeof payload !== "object") {
    return getFallbackEntryState();
  }

  const record = payload as Record<string, unknown>;
  const state = asEntryState(record.state);
  const reason_code = asReasonCode(record.reason_code);
  const route_hint = asRouteHint(record.route_hint);

  if (!state || !reason_code || !route_hint) {
    return getFallbackEntryState();
  }

  return {
    state,
    reason_code,
    route_hint,
    onboarding_draft: normalizeDraft(record.onboarding_draft),
    candidate_fragment: normalizeCandidateFragment(record.candidate_fragment),
    scheduled_deletion_at: normalizeScheduledDeletionAt(record.scheduled_deletion_at),
    retryable: record.retryable !== false,
    evaluation_version: DEFAULT_EVALUATION_VERSION,
  };
}

export async function resolveEntryState(
  supabase: SupabaseRpcClient,
): Promise<EntryStateResponse> {
  try {
    const { data, error } = await supabase.rpc("resolve_entry_state");
    if (error) {
      return getFallbackEntryState();
    }
    return normalizeEntryStateResponse(data);
  } catch {
    return getFallbackEntryState();
  }
}

export function getEntryStateOnboardingStatus(
  entryState: EntryStateResponse | null,
): "complete" | "incomplete" | "unknown" {
  if (entryState?.state === "complete") return "complete";
  if (entryState?.state === "incomplete") return "incomplete";
  return "unknown";
}

export function isRecoveryEntryState(
  entryState: EntryStateResponse | null,
): boolean {
  if (!entryState) return false;
  return (
    entryState.state === "deletion_requested"
    || entryState.state === "missing_profile"
    || entryState.state === "suspected_fragmented_identity"
    || entryState.state === "account_suspended"
    || entryState.state === "hard_error"
  );
}

export function getAuthProvider(user: AuthLikeUser | null | undefined): EntryProviderHint | null {
  if (!user) return null;
  if (typeof user.phone === "string" && user.phone.trim().length > 0) return "phone";

  const provider = user.app_metadata?.provider;
  if (provider === "phone" || provider === "email" || provider === "google" || provider === "apple") {
    return provider;
  }

  return "email";
}
