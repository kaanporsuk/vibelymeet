const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64Url(new Uint8Array(signature));
}

function sortedSigningData(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function normalizeHostname(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase();
}

export async function signBunnyStreamDirectoryUrl(params: {
  hostname: string;
  securityKey: string;
  videoId: string;
  fileName: string;
  expires: number;
}): Promise<string> {
  const tokenPath = `/${params.videoId}/`;
  const signingData = sortedSigningData({ token_path: tokenPath });
  const token = `HS256-${await signPayload(
    params.securityKey,
    `${tokenPath}${params.expires}${signingData}`,
  )}`;
  const tokenSegment = `bcdn_token=${token}&expires=${params.expires}&token_path=${encodeURIComponent(tokenPath)}`;
  return `https://${normalizeHostname(params.hostname)}/${tokenSegment}/${params.videoId}/${params.fileName}`;
}

/**
 * Signs a single Bunny Storage object for delivery through a Token-Authentication
 * pull zone (query-string form), using the same Advanced (HMAC-SHA256) token as
 * `signBunnyStreamDirectoryUrl`: token = "HS256-" + base64url(HMAC-SHA256(key,
 * signaturePath + expires + signingData)). `token_path` is the exact object path so
 * the token is scoped to one file.
 *
 * NOTE (rollout): the pull zone must have Advanced Token Authentication enabled and its
 * cache key configured to ignore the `token`/`expires` query params — otherwise every
 * signed URL becomes its own CDN cache entry and cross-viewer hit-rate stays ~0.
 * Validate the exact accepted form against the configured zone before enabling broadly.
 */
export async function signBunnyStorageUrl(params: {
  hostname: string;
  securityKey: string;
  /** Storage object path, e.g. "photos/match-<id>/<user>/req-<hash>.jpg". */
  path: string;
  expires: number;
}): Promise<string> {
  const objectPath = `/${params.path.replace(/^\/+/, "")}`;
  const signingData = sortedSigningData({ token_path: objectPath });
  const token = `HS256-${await signPayload(
    params.securityKey,
    `${objectPath}${params.expires}${signingData}`,
  )}`;
  const encodedPath = objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return (
    `https://${normalizeHostname(params.hostname)}${encodedPath}` +
    `?token=${encodeURIComponent(token)}&expires=${params.expires}&token_path=${encodeURIComponent(objectPath)}`
  );
}
