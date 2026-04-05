/**
 * Server-owned onboarding orchestration.
 *
 * The backend (onboarding_drafts table + RPCs) is the source of truth.
 * These helpers are thin typed wrappers around the RPCs that both web and
 * native call. No client-side profile upsert happens here.
 */

import {
  getOnboardingStageForStep,
  type OnboardingData,
  type OnboardingStage,
} from "./onboardingTypes";
import { normalizeRelationshipIntentId } from "./profileContracts";

// ─── Minimal Supabase client interface ───────────────────────────────────────

export interface SupabaseClient {
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

// ─── Draft load ──────────────────────────────────────────────────────────────

export interface ServerDraft {
  schema_version: number;
  current_step: number;
  current_stage: string;
  onboarding_data: OnboardingData;
  updated_at: string;
}

export interface LoadDraftResult {
  draft: ServerDraft | null;
  error: string | null;
}

export async function loadOnboardingDraft(
  supabase: SupabaseClient,
  userId: string,
): Promise<LoadDraftResult> {
  try {
    const { data, error } = await supabase.rpc("get_onboarding_draft", {
      p_user_id: userId,
    });
    if (error) {
      return { draft: null, error: `draft_load_failed: ${error.message}` };
    }
    if (!data) {
      return { draft: null, error: null };
    }
    const raw = data as Record<string, unknown>;
    if (raw.error) {
      return { draft: null, error: `draft_load_failed: ${String(raw.error)}` };
    }
    const d = raw.draft as Record<string, unknown> | null;
    if (!d) {
      return { draft: null, error: null };
    }
    return {
      draft: {
        schema_version: Number(d.schema_version ?? 2),
        current_step: Number(d.current_step ?? 0),
        current_stage: String(d.current_stage ?? "none"),
        onboarding_data: d.onboarding_data as OnboardingData,
        updated_at: String(d.updated_at ?? ""),
      },
      error: null,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { draft: null, error: `draft_load_failed: ${msg}` };
  }
}

// ─── Draft save ──────────────────────────────────────────────────────────────

export interface SaveDraftResult {
  success: boolean;
  error: string | null;
}

export async function saveOnboardingDraft(
  supabase: SupabaseClient,
  userId: string,
  step: number,
  data: OnboardingData,
  platform: "web" | "native",
): Promise<SaveDraftResult> {
  const stage: OnboardingStage = getOnboardingStageForStep(step);
  try {
    const { data: result, error } = await supabase.rpc("save_onboarding_draft", {
      p_user_id: userId,
      p_step: step,
      p_stage: stage,
      p_data: data as unknown as Record<string, unknown>,
      p_schema_version: 2,
      p_platform: platform,
    });
    if (error) {
      return { success: false, error: `draft_save_failed: ${error.message}` };
    }
    const r = result as Record<string, unknown> | null;
    if (r && r.success === false) {
      return { success: false, error: `draft_save_failed: ${String(r.error ?? "unknown")}` };
    }
    return { success: true, error: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `draft_save_failed: ${msg}` };
  }
}

// ─── Finalization ────────────────────────────────────────────────────────────

export interface CompletionResult {
  success: boolean;
  vibeScore: number;
  vibeScoreLabel: string;
  alreadyCompleted: boolean;
  errors: string[];
  errorCode: string | null;
}

const FAILED = (errorCode: string, errors: string[]): CompletionResult => ({
  success: false,
  vibeScore: 0,
  vibeScoreLabel: "",
  alreadyCompleted: false,
  errors,
  errorCode,
});

export interface CompletionDeps {
  supabase: SupabaseClient;
  userId: string;
  data: OnboardingData;
  clearLocalDraft: () => Promise<void>;
  trackEvent: (name: string, props?: Record<string, string | number | boolean | null>) => void;
  platform: "web" | "native";
  authMethod: string;
  startedAt: number;
}

/**
 * Full server-owned finalization:
 * 1. Call finalize_onboarding RPC with final data payload (atomic save+validate+write)
 * 2. Welcome email (best-effort, only on fresh completion)
 * 3. Clear local cache
 * 4. Analytics (only on fresh completion)
 *
 * The RPC receives the client's latest OnboardingData directly via p_final_data.
 * If the active onboarding draft is missing, the backend materializes a
 * coherent draft row from that payload before validation and completion, so
 * dropped debounced draft saves cannot trigger a last-screen no_draft failure.
 *
 * No client-side profiles.upsert. Server owns the write.
 */
export async function executeOnboardingCompletion(
  deps: CompletionDeps,
): Promise<CompletionResult> {
  const { supabase, userId, data, platform, authMethod, startedAt } = deps;

  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "finalize_onboarding",
      {
        p_user_id: userId,
        p_final_data: data as unknown as Record<string, unknown>,
      },
    );
    if (rpcError) {
      return FAILED("finalize_rpc_error", [rpcError.message]);
    }
    const r = rpcResult as Record<string, unknown> | null;
    if (!r || r.success !== true) {
      const serverErrors = Array.isArray(r?.errors)
        ? (r.errors as string[])
        : ["Server finalization failed"];
      // Surface backend error codes verbatim so client retry UX stays aligned
      // to the live RPC contract.
      const errorCode = String(r?.error ?? "finalize_validation_failed");
      return FAILED(errorCode, serverErrors);
    }

    const vibeScore = Number(r.vibe_score ?? 0);
    const vibeScoreLabel = String(r.vibe_score_label ?? "New");
    const alreadyCompleted = r.already_completed === true;

    // Welcome email: best-effort, only on fresh completion.
    // The server's already_completed flag is authoritative — concurrent
    // callers that lose the lock race will always get already_completed=true,
    // preventing duplicate welcome emails.
    if (!alreadyCompleted) {
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
    }

    // Clear local cache
    try {
      await deps.clearLocalDraft();
    } catch {
      console.warn("[onboarding] local draft cleanup failed (non-fatal)");
    }

    // Analytics: only on fresh completion to avoid double-counting.
    // Same already_completed guard prevents concurrent callers from both
    // firing analytics.
    if (!alreadyCompleted) {
      deps.trackEvent("onboarding_completed", {
        platform,
        auth_method: authMethod,
        has_vibe_video: data.vibeVideoRecorded,
        photo_count: data.photos.length,
        has_about_me: !!data.aboutMe.trim(),
        has_height: !!data.heightCm,
        has_job: !!data.job.trim(),
        relationship_intent: normalizeRelationshipIntentId(data.relationshipIntent),
        total_time_seconds: Math.round((Date.now() - startedAt) / 1000),
        vibe_score: vibeScore,
      });
    }

    return {
      success: true,
      vibeScore,
      vibeScoreLabel,
      alreadyCompleted,
      errors: [],
      errorCode: null,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return FAILED("finalize_unexpected", [msg]);
  }
}
