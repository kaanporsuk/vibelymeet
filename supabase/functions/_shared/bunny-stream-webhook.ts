const SIGNATURE_VERSION_HEADER = "X-BunnyStream-Signature-Version";
const SIGNATURE_ALGORITHM_HEADER = "X-BunnyStream-Signature-Algorithm";
const SIGNATURE_HEADER = "X-BunnyStream-Signature";
const EXPECTED_SIGNATURE_VERSION = "v1";
const EXPECTED_SIGNATURE_ALGORITHM = "hmac-sha256";
const LOWERCASE_SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export type BunnyStreamSignatureFailureReason =
  | "signature_secret_unconfigured"
  | "missing_signature_version"
  | "invalid_signature_version"
  | "missing_signature_algorithm"
  | "invalid_signature_algorithm"
  | "missing_signature"
  | "malformed_signature"
  | "invalid_signature";

export type BunnyStreamSignatureVerificationResult =
  | { ok: true }
  | { ok: false; reason: BunnyStreamSignatureFailureReason };

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

export function constantTimeCompare(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

export function hasAnyBunnyStreamSignatureHeader(headers: Headers): boolean {
  return headers.has(SIGNATURE_VERSION_HEADER) ||
    headers.has(SIGNATURE_ALGORITHM_HEADER) ||
    headers.has(SIGNATURE_HEADER);
}

function bytesToLowercaseHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(secret: string, rawBody: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  return bytesToLowercaseHex(new Uint8Array(signature));
}

export async function verifyBunnyStreamWebhookSignature(
  headers: Headers,
  rawBody: string,
  streamApiKey: string | undefined | null,
): Promise<BunnyStreamSignatureVerificationResult> {
  const secret = streamApiKey?.trim();
  if (!secret) return { ok: false, reason: "signature_secret_unconfigured" };

  const version = headers.get(SIGNATURE_VERSION_HEADER)?.trim() ?? "";
  if (!version) return { ok: false, reason: "missing_signature_version" };
  if (version !== EXPECTED_SIGNATURE_VERSION) {
    return { ok: false, reason: "invalid_signature_version" };
  }

  const algorithm = headers.get(SIGNATURE_ALGORITHM_HEADER)?.trim() ?? "";
  if (!algorithm) return { ok: false, reason: "missing_signature_algorithm" };
  if (algorithm !== EXPECTED_SIGNATURE_ALGORITHM) {
    return { ok: false, reason: "invalid_signature_algorithm" };
  }

  const receivedSignature = headers.get(SIGNATURE_HEADER)?.trim() ?? "";
  if (!receivedSignature) return { ok: false, reason: "missing_signature" };
  if (!LOWERCASE_SHA256_HEX_RE.test(receivedSignature)) {
    return { ok: false, reason: "malformed_signature" };
  }

  const expectedSignature = await hmacSha256Hex(secret, rawBody);
  if (!constantTimeCompare(expectedSignature, receivedSignature)) {
    return { ok: false, reason: "invalid_signature" };
  }

  return { ok: true };
}
