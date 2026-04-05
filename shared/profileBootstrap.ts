import type { User } from "@supabase/supabase-js";
import { buildBootstrapProfileInsert, pickBootstrapName } from "@shared/profileContracts";

export type EnsureProfileExistsReason =
  | "web_auth_signup"
  | "web_auth_post_login"
  | "sign_in_screen_effect"
  | "email_signup";

export type EnsureProfileFailureCode =
  | "profile_lookup_failed"
  | "profile_insert_failed_retryable"
  | "profile_insert_failed_terminal"
  | "profile_insert_unexpected";

export type EnsureProfileReadyResult =
  | { status: "ready"; source: "existing" | "created"; created: boolean }
  | {
      status: "failed";
      code: EnsureProfileFailureCode;
      retryable: boolean;
      message: string;
    };

type ProfileRowId = { id: string };
type BootstrapProfileInsert = ReturnType<typeof buildBootstrapProfileInsert>;

type ProfilesTable = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => PromiseLike<{ data: ProfileRowId | null; error: unknown | null }>;
    };
  };
  insert: (values: BootstrapProfileInsert) => PromiseLike<{ error: unknown | null }>;
};

export type ProfileBootstrapClient = {
  from: (table: "profiles") => ProfilesTable;
};

const inflightByUserId = new Map<string, Promise<EnsureProfileReadyResult>>();

function asMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "Unexpected profile bootstrap failure.";
}

function isConflictError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
  return code === "23505" || message.includes("duplicate key") || message.includes("already exists");
}

function isRetryableError(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code ?? "").toLowerCase();
  const message = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
  const status = Number((error as { status?: number } | null)?.status ?? 0);
  if (status >= 500) return true;
  if (code === "etimedout" || code === "econnreset" || code === "econnrefused") return true;
  return message.includes("network") || message.includes("timeout") || message.includes("temporarily");
}

async function readProfileExists(
  client: ProfileBootstrapClient,
  userId: string,
): Promise<{ exists: boolean; error: unknown | null }> {
  const { data, error } = await client
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { exists: false, error };
  return { exists: !!data, error: null };
}

async function ensureProfileReadyOnce(
  client: ProfileBootstrapClient,
  user: User,
): Promise<EnsureProfileReadyResult> {
  const existingLookup = await readProfileExists(client, user.id);
  if (existingLookup.error) {
    return {
      status: "failed",
      code: "profile_lookup_failed",
      retryable: true,
      message: asMessage(existingLookup.error),
    };
  }
  if (existingLookup.exists) return { status: "ready", source: "existing", created: false };

  const payload = buildBootstrapProfileInsert({
    userId: user.id,
    name: pickBootstrapName(user.user_metadata as Record<string, unknown> | undefined),
    phoneNumber: user.phone ?? null,
  });

  const { error: insertError } = await client.from("profiles").insert(payload);
  if (!insertError) {
    return { status: "ready", source: "created", created: true };
  }

  if (isConflictError(insertError)) {
    const conflictLookup = await readProfileExists(client, user.id);
    if (conflictLookup.exists) {
      return { status: "ready", source: "existing", created: false };
    }
    return {
      status: "failed",
      code: "profile_insert_failed_retryable",
      retryable: true,
      message: conflictLookup.error
        ? `Profile insert conflicted and follow-up read failed: ${asMessage(conflictLookup.error)}`
        : "Profile insert conflicted and profile is not yet visible; retrying may succeed shortly.",
    };
  }

  const retryable = isRetryableError(insertError);
  return {
    status: "failed",
    code: retryable ? "profile_insert_failed_retryable" : "profile_insert_failed_terminal",
    retryable,
    message: asMessage(insertError),
  };
}

async function ensureProfileReadyWithSingleRetry(
  client: ProfileBootstrapClient,
  user: User,
): Promise<EnsureProfileReadyResult> {
  const firstAttempt = await ensureProfileReadyOnce(client, user);
  if (firstAttempt.status === "ready" || !firstAttempt.retryable) return firstAttempt;
  return ensureProfileReadyOnce(client, user);
}

export async function ensureProfileReady(
  client: ProfileBootstrapClient,
  user: User,
  reason: EnsureProfileExistsReason,
): Promise<EnsureProfileReadyResult> {
  const cached = inflightByUserId.get(user.id);
  if (cached) return cached;

  const inflight = (async () => {
    try {
      return await ensureProfileReadyWithSingleRetry(client, user);
    } catch (error) {
      return {
        status: "failed",
        code: "profile_insert_unexpected",
        retryable: false,
        message: asMessage(error),
      } as EnsureProfileReadyResult;
    }
  })();

  inflightByUserId.set(user.id, inflight);
  try {
    const result = await inflight;
    if (result.status === "failed") {
      console.warn("[profile-bootstrap] ensure failed", {
        reason,
        userId: user.id,
        code: result.code,
        message: result.message,
      });
    }
    return result;
  } finally {
    inflightByUserId.delete(user.id);
  }
}
