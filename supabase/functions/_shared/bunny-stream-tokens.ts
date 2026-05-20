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
