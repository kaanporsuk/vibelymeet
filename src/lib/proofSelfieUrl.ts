/**
 * proof-selfies bucket paths must never go through {@link resolvePhotoUrl} /
 * {@link getImageUrl}: those helpers assume Bunny or legacy *public* object URLs.
 */

export const PROOF_SELFIES_BUCKET = "proof-selfies";

const BUCKET_PREFIX = `${PROOF_SELFIES_BUCKET}/`;

export function isAbsoluteMediaUrl(raw: string): boolean {
  const p = raw.trim();
  return (
    p.startsWith("http://") ||
    p.startsWith("https://") ||
    p.startsWith("blob:") ||
    p.startsWith("data:")
  );
}

/**
 * Returns the object path inside `proof-selfies`, or null if the value is not a storage path.
 */
export function normalizeProofSelfieObjectPath(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let p = raw.trim();
  if (!p) return null;
  if (isAbsoluteMediaUrl(p)) return null;
  p = p.replace(/^\/+/, "");
  if (p.startsWith(BUCKET_PREFIX)) p = p.slice(BUCKET_PREFIX.length);
  return p || null;
}
