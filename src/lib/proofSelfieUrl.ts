/**
 * proof-selfies bucket paths must never go through {@link resolvePhotoUrl} /
 * {@link getImageUrl}: those helpers assume Bunny or legacy *public* object URLs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const PROOF_SELFIES_BUCKET = "proof-selfies";

const BUCKET_PREFIX = `${PROOF_SELFIES_BUCKET}/`;

export type ProofSelfieStoredShape =
  | "empty"
  | "raw_object_key"
  | "bucket_prefixed_key"
  | "supabase_storage_proof_selfies"
  /** Legacy broken URL: /object/public/{userId}/file.jpg (missing bucket segment). */
  | "supabase_storage_public_missing_bucket"
  | "supabase_storage_other_bucket"
  | "absolute_non_supabase"
  | "unusable";

export function isAbsoluteMediaUrl(raw: string): boolean {
  const p = raw.trim();
  return (
    p.startsWith("http://") ||
    p.startsWith("https://") ||
    p.startsWith("blob:") ||
    p.startsWith("data:")
  );
}

export function looksLikeSupabaseStorageUrl(url: string): boolean {
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

const UUID_FOLDER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse Supabase Storage URLs for bucket `proof-selfies`, including legacy public URLs
 * that omitted the bucket segment (treated as object key under proof-selfies).
 */
function objectPathFromSupabaseStoragePathname(pathname: string): {
  objectPath: string | null;
  shape: ProofSelfieStoredShape;
} {
  const p = pathname.replace(/\/+$/, "");

  const explicit = p.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/proof-selfies\/(.+)$/i);
  if (explicit) {
    const inner = decodePathSeg(explicit[1]).replace(/^\/+/, "");
    return inner ? { objectPath: inner, shape: "supabase_storage_proof_selfies" } : { objectPath: null, shape: "unusable" };
  }

  const generic = p.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/i);
  if (generic) {
    const first = generic[1];
    const rest = decodePathSeg(generic[2]).replace(/^\/+/, "");
    if (first.toLowerCase() === PROOF_SELFIES_BUCKET) {
      return rest ? { objectPath: rest, shape: "supabase_storage_proof_selfies" } : { objectPath: null, shape: "unusable" };
    }
    if (UUID_FOLDER.test(first) && rest) {
      return { objectPath: `${first}/${rest}`, shape: "supabase_storage_public_missing_bucket" };
    }
    return { objectPath: null, shape: "supabase_storage_other_bucket" };
  }

  return { objectPath: null, shape: "unusable" };
}

/**
 * Returns the object path inside `proof-selfies` for signing, or null if the value cannot
 * be mapped (non-Supabase absolute URL, wrong bucket, malformed).
 */
export function resolveProofSelfieObjectPathForSigning(raw: string | null | undefined): {
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

/**
 * Returns the object path inside `proof-selfies`, or null if the value is not a storage path.
 * @deprecated Prefer {@link resolveProofSelfieObjectPathForSigning} for admin signing flow.
 */
export function normalizeProofSelfieObjectPath(raw: string | null | undefined): string | null {
  const { objectPath } = resolveProofSelfieObjectPathForSigning(raw);
  return objectPath;
}

/**
 * Best-effort: confirm an object exists by listing its parent folder (typical layout: userId/file.jpg).
 */
export async function checkProofSelfieObjectExists(
  supabase: SupabaseClient,
  objectPath: string
): Promise<boolean> {
  const slash = objectPath.indexOf("/");
  if (slash <= 0) return false;
  const folder = objectPath.slice(0, slash);
  const fileName = objectPath.slice(slash + 1);
  if (!fileName) return false;

  const { data, error } = await supabase.storage.from(PROOF_SELFIES_BUCKET).list(folder, { limit: 200 });
  if (error || !data) return false;
  return data.some((f) => f.name === fileName);
}
