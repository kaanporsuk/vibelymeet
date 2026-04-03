import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Path resolution must stay aligned with `src/lib/proofSelfieUrl.ts` (resolveProofSelfieObjectPathForSigning).
 */
const PROOF_SELFIES_BUCKET = "proof-selfies";
const BUCKET_PREFIX = `${PROOF_SELFIES_BUCKET}/`;
const UUID_FOLDER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProofSelfieStoredShape =
  | "empty"
  | "raw_object_key"
  | "bucket_prefixed_key"
  | "supabase_storage_proof_selfies"
  | "supabase_storage_public_missing_bucket"
  | "supabase_storage_other_bucket"
  | "absolute_non_supabase"
  | "unusable";

function isAbsoluteMediaUrl(raw: string): boolean {
  const p = raw.trim();
  return (
    p.startsWith("http://") ||
    p.startsWith("https://") ||
    p.startsWith("blob:") ||
    p.startsWith("data:")
  );
}

function looksLikeSupabaseStorageUrl(url: string): boolean {
  try {
    const h = new URL(url.trim()).hostname;
    return h.includes("supabase.co") || h.includes("supabase.in");
  } catch {
    return false;
  }
}

function decodePathSeg(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

function objectPathFromSupabaseStoragePathname(pathname: string): {
  objectPath: string | null;
  shape: ProofSelfieStoredShape;
} {
  const p = pathname.replace(/\/+$/, "");

  const explicit = p.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/proof-selfies\/(.+)$/i,
  );
  if (explicit) {
    const inner = decodePathSeg(explicit[1]).replace(/^\/+/, "");
    return inner
      ? { objectPath: inner, shape: "supabase_storage_proof_selfies" }
      : { objectPath: null, shape: "unusable" };
  }

  const generic = p.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/i,
  );
  if (generic) {
    const first = generic[1];
    const rest = decodePathSeg(generic[2]).replace(/^\/+/, "");
    if (first.toLowerCase() === PROOF_SELFIES_BUCKET) {
      return rest
        ? { objectPath: rest, shape: "supabase_storage_proof_selfies" }
        : { objectPath: null, shape: "unusable" };
    }
    if (UUID_FOLDER.test(first) && rest) {
      return {
        objectPath: `${first}/${rest}`,
        shape: "supabase_storage_public_missing_bucket",
      };
    }
    return { objectPath: null, shape: "supabase_storage_other_bucket" };
  }

  return { objectPath: null, shape: "unusable" };
}

function resolveProofSelfieObjectPathForSigning(raw: string | null | undefined): {
  objectPath: string | null;
  shape: ProofSelfieStoredShape;
} {
  if (raw == null || raw.trim() === "") return { objectPath: null, shape: "empty" };
  const t = raw.trim();

  if (isAbsoluteMediaUrl(t)) {
    if (!looksLikeSupabaseStorageUrl(t)) {
      return { objectPath: null, shape: "absolute_non_supabase" };
    }
    try {
      const { pathname } = new URL(t);
      return objectPathFromSupabaseStoragePathname(pathname);
    } catch {
      return { objectPath: null, shape: "unusable" };
    }
  }

  let p = t.replace(/^\/+/, "");
  const hadBucketPrefix = p.startsWith(BUCKET_PREFIX);
  if (hadBucketPrefix) p = p.slice(BUCKET_PREFIX.length);
  if (!p) return { objectPath: null, shape: "unusable" };
  return {
    objectPath: p,
    shape: hadBucketPrefix ? "bucket_prefixed_key" : "raw_object_key",
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SignOutcome =
  | { kind: "signed"; signedUrl: string }
  | { kind: "direct"; url: string }
  | { kind: "fail"; message: string; shape: ProofSelfieStoredShape };

async function tryResolveSelfieDisplayUrl(
  service: ReturnType<typeof createClient>,
  raw: string,
): Promise<SignOutcome> {
  const { objectPath, shape } = resolveProofSelfieObjectPathForSigning(raw);

  if (objectPath) {
    const { data, error } = await service.storage
      .from(PROOF_SELFIES_BUCKET)
      .createSignedUrl(objectPath, 3600);
    if (error || !data?.signedUrl) {
      return {
        kind: "fail",
        message: error?.message ?? "Could not create signed URL for proof selfie",
        shape,
      };
    }
    return { kind: "signed", signedUrl: data.signedUrl };
  }

  if (shape === "absolute_non_supabase") {
    const trimmed = raw.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      return {
        kind: "fail",
        message:
          "Stored selfie is not an object key and valid direct display is only allowed for http(s) URLs",
        shape,
      };
    }
    return { kind: "direct", url: trimmed };
  }

  return {
    kind: "fail",
    message: "Could not derive proof-selfies object path from stored selfie value",
    shape,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse({ success: false, error: "Not authenticated" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ success: false, error: "Authentication failed" }, 401);
    }

    const admin = createClient(supabaseUrl, supabaseService);
    const { data: roleData } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return jsonResponse({ success: false, error: "Unauthorized — admin only" }, 403);
    }

    let body: { verification_id?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
    }

    const verificationId = body.verification_id;
    if (!verificationId || typeof verificationId !== "string") {
      return jsonResponse({ success: false, error: "Missing verification_id" }, 400);
    }

    const { data: verification, error: fetchErr } = await admin
      .from("photo_verifications")
      .select("id, user_id, selfie_url")
      .eq("id", verificationId)
      .maybeSingle();

    if (fetchErr || !verification) {
      return jsonResponse(
        { success: false, error: "Verification not found" },
        200,
      );
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("proof_selfie_url")
      .eq("id", verification.user_id)
      .maybeSingle();

    const verificationSelfie = (verification.selfie_url as string) ?? "";
    const profileSelfie = profile?.proof_selfie_url ?? "";

    let outcome = await tryResolveSelfieDisplayUrl(admin, verificationSelfie);
    if (
      outcome.kind === "fail" &&
      profileSelfie.length > 0 &&
      profileSelfie !== verificationSelfie
    ) {
      outcome = await tryResolveSelfieDisplayUrl(admin, profileSelfie);
    }

    if (outcome.kind === "signed") {
      return jsonResponse({ success: true, signedUrl: outcome.signedUrl }, 200);
    }
    if (outcome.kind === "direct") {
      return jsonResponse({ success: true, directUrl: outcome.url }, 200);
    }

    return jsonResponse(
      {
        success: false,
        error: outcome.message,
        shape: outcome.shape,
      },
      200,
    );
  } catch (err) {
    console.error("admin-proof-selfie-sign:", err);
    return jsonResponse({ success: false, error: "Server error" }, 500);
  }
});
