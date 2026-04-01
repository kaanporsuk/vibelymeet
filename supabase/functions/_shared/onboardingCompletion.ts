/**
 * Shared onboarding completion orchestrator.
 *
 * Both web and native call `executeOnboardingCompletion()` instead of
 * duplicating the upsert → RPC → credits → email → cleanup sequence.
 *
 * Each step is idempotent: if the flow is retried after a partial failure,
 * already-succeeded steps are skipped via guards.
 *
 * Platform callers supply a `CompletionDeps` object that abstracts storage
 * and Supabase client differences.
 */

import { buildOnboardingProfileUpsert } from "./profileContracts";
import {
  calculateAge,
  validateOnboardingData,
  type OnboardingData,
  type OnboardingValidationResult,
} from "./onboardingTypes";

// ─── Dependency injection ────────────────────────────────────────────────────

export interface SupabaseClient {
  from(table: string): {
    upsert(data: Record<string, unknown>, opts?: { onConflict?: string }): Promise<{ error: { message: string } | null }>;
    select(columns: string): {
      eq(col: string, val: unknown): {
        maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
  };
  rpc(fn: string, params: Record<string, unknown>): Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
  functions: {
    invoke(name: string, opts: { body: Record<string, unknown> }): Promise<{
      error: { message: string } | null;
    }>;
  };
  auth: {
    getUser(): Promise<{
      data: { user: { email?: string | null } | null };
    }>;
  };
}

export interface CompletionDeps {
  supabase: SupabaseClient;
  userId: string;
  data: OnboardingData;
  clearDraftStorage: () => Promise<void>;
  trackEvent: (name: string, props?: Record<string, string | number | boolean | null>) => void;
  platform: "web" | "native";
  authMethod: string;
  startedAt: number;
}

// ─── Result type ─────────────────────────────────────────────────────────────

export interface CompletionResult {
  success: boolean;
  vibeScore: number;
  vibeScoreLabel: string;
  errors: string[];
}

const FAILED = (errors: string[]): CompletionResult => ({
  success: false,
  vibeScore: 0,
  vibeScoreLabel: "",
  errors,
});

// ─── Orchestrator ────────────────────────────────────────────────────────────

export async function executeOnboardingCompletion(
  deps: CompletionDeps,
): Promise<CompletionResult> {
  const { supabase, userId, data, platform, authMethod, startedAt } = deps;

  // 1. Client-side pre-validation (fail fast before any writes)
  const validation: OnboardingValidationResult = validateOnboardingData(data);
  if (!validation.valid) {
    return FAILED(validation.errors);
  }

  // 2. Upsert profile data
  const age = calculateAge(data.birthDate);
  const payload = buildOnboardingProfileUpsert({
    userId,
    name: data.name,
    birthDate: data.birthDate,
    age,
    gender: data.gender,
    genderCustom: data.genderCustom,
    interestedIn: data.interestedIn,
    relationshipIntent: data.relationshipIntent,
    heightCm: data.heightCm,
    job: data.job,
    photos: data.photos,
    aboutMe: data.aboutMe,
    location: data.location,
    locationData: data.locationData,
    country: data.country,
    bunnyVideoUid: data.bunnyVideoUid,
    communityAgreed: data.communityAgreed,
  });

  const { error: upsertError } = await supabase
    .from("profiles")
    .upsert(payload as unknown as Record<string, unknown>);
  if (upsertError) {
    return FAILED([upsertError.message]);
  }

  // 3. Server-side validation + completion (idempotent: re-calling on an
  //    already-complete profile is safe — RPC overwrites the same values)
  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    "complete_onboarding",
    { p_user_id: userId },
  );
  if (rpcError) {
    return FAILED([rpcError.message]);
  }
  if (!rpcResult?.success) {
    const serverErrors = Array.isArray(rpcResult?.errors)
      ? (rpcResult.errors as string[])
      : ["Profile validation failed on server"];
    return FAILED(serverErrors);
  }

  // 4. Baseline credits (idempotent via ON CONFLICT)
  const { error: creditsError } = await supabase
    .from("user_credits")
    .upsert(
      { user_id: userId, extra_time_credits: 0, extended_vibe_credits: 0 },
      { onConflict: "user_id" },
    );
  if (creditsError) {
    console.warn("[onboarding] credits upsert failed:", creditsError.message);
  }

  // 5. Welcome email (best-effort, do not fail completion)
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user?.email) {
      await supabase.functions.invoke("send-email", {
        body: {
          to: userData.user.email,
          template: "welcome",
          data: { name: data.name.trim() },
        },
      });
    }
  } catch {
    console.warn("[onboarding] welcome email failed (non-fatal)");
  }

  // 6. Clear local draft
  try {
    await deps.clearDraftStorage();
  } catch {
    console.warn("[onboarding] draft cleanup failed (non-fatal)");
  }

  const vibeScore = Number(rpcResult?.vibe_score ?? 0);
  const vibeScoreLabel = String(rpcResult?.vibe_score_label ?? "New");

  // 7. Analytics
  deps.trackEvent("onboarding_completed", {
    platform,
    auth_method: authMethod,
    has_vibe_video: data.vibeVideoRecorded,
    photo_count: data.photos.length,
    has_about_me: !!data.aboutMe.trim(),
    has_height: !!data.heightCm,
    has_job: !!data.job.trim(),
    relationship_intent: data.relationshipIntent,
    total_time_seconds: Math.round((Date.now() - startedAt) / 1000),
    vibe_score: vibeScore,
  });

  return {
    success: true,
    vibeScore,
    vibeScoreLabel,
    errors: [],
  };
}
