import type { User } from "@supabase/supabase-js";

export type EnsureProfileExistsReason =
  | "web_auth_signup"
  | "web_auth_post_login"
  | "sign_in_screen_effect"
  | "email_signup";

export type EnsureProfileFailureCode =
  | "profile_lookup_failed"
  | "profile_missing"
  | "profile_lookup_unexpected";

export type EnsureProfileReadyResult =
  | { status: "ready"; source: "existing"; created: false }
  | {
      status: "failed";
      code: EnsureProfileFailureCode;
      retryable: boolean;
      message: string;
    };

type ProfileRowId = { id: string };

type ProfilesTable = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => PromiseLike<{ data: ProfileRowId | null; error: unknown | null }>;
    };
  };
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  return {
    status: "failed",
    code: "profile_missing",
    retryable: false,
    message: "Profile row is missing after backend auth bootstrap.",
  };
}

async function ensureProfileReadyWithSingleRetry(
  client: ProfileBootstrapClient,
  user: User,
): Promise<EnsureProfileReadyResult> {
  const retryDelaysMs = [0, 250, 700];
  let lastFailure: EnsureProfileReadyResult | null = null;

  for (const [index, delayMs] of retryDelaysMs.entries()) {
    if (index > 0) {
      await delay(delayMs);
    }
    const attempt = await ensureProfileReadyOnce(client, user);
    if (attempt.status === "ready") return attempt;
    lastFailure = attempt;
    if (!attempt.retryable && attempt.code !== "profile_missing") return attempt;
  }

  return (
    lastFailure ?? {
      status: "failed",
      code: "profile_lookup_unexpected",
      retryable: false,
      message: "Unexpected profile readiness failure.",
    }
  );
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
        code: "profile_lookup_unexpected",
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
