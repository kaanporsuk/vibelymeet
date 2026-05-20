import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const live = process.env.MEDIA_SMOKE_LIVE === "1";

if (!live) {
  console.log("MEDIA_SMOKE_LIVE is not 1; skipping live media storage idempotency smoke.");
  process.exit(0);
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bunnyStorageZone = process.env.BUNNY_STORAGE_ZONE;
const bunnyStorageApiKey = process.env.BUNNY_STORAGE_API_KEY;
const userJwt = process.env.MEDIA_SMOKE_USER_JWT;
const userId = process.env.MEDIA_SMOKE_USER_ID;
const fixturePath = process.env.MEDIA_SMOKE_PHOTO_FIXTURE;

assert.ok(supabaseUrl, "SUPABASE_URL or VITE_SUPABASE_URL is required");
assert.ok(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required");
assert.ok(bunnyStorageZone, "BUNNY_STORAGE_ZONE is required");
assert.ok(bunnyStorageApiKey, "BUNNY_STORAGE_API_KEY is required");
assert.ok(userJwt, "MEDIA_SMOKE_USER_JWT is required");
assert.ok(userId, "MEDIA_SMOKE_USER_ID is required");
assert.ok(fixturePath, "MEDIA_SMOKE_PHOTO_FIXTURE is required");

const clientRequestId = `media-smoke-${crypto.randomUUID()}`;
const fixture = readFileSync(fixturePath);

async function uploadOnce() {
  const form = new FormData();
  form.append("context", "profile_studio");
  form.append("client_request_id", clientRequestId);
  form.append("file", new Blob([fixture], { type: "image/jpeg" }), "smoke.jpg");

  const response = await fetch(`${supabaseUrl}/functions/v1/upload-image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userJwt}`,
      "x-client-request-id": clientRequestId,
    },
    body: form,
  });
  const data = await response.json();
  assert.equal(data.success, true, JSON.stringify(data));
  assert.ok(data.path, "upload response must include path");
  assert.ok(data.assetId, "upload response must include assetId");
  assert.ok(data.receiptId, "upload response must include receiptId");
  return data as { path: string; assetId: string; receiptId: string };
}

async function assertBunnyStorageObjectExists(path: string) {
  const normalizedPath = path.replace(/^\/+/, "");
  const url = `https://storage.bunnycdn.com/${bunnyStorageZone}/${normalizedPath}`;
  const headers = { AccessKey: bunnyStorageApiKey! };
  const head = await fetch(url, { method: "HEAD", headers });
  if (head.ok) return;

  const rangedGet = await fetch(url, {
    method: "GET",
    headers: {
      ...headers,
      Range: "bytes=0-0",
    },
  });
  assert.ok(
    rangedGet.ok,
    `expected Bunny object to exist at ${normalizedPath}; HEAD=${head.status}, GET=${rangedGet.status}`,
  );
}

const first = await uploadOnce();
const second = await uploadOnce();
const third = await uploadOnce();

assert.equal(second.path, first.path);
assert.equal(third.path, first.path);
assert.equal(second.assetId, first.assetId);
assert.equal(third.assetId, first.assetId);
assert.equal(second.receiptId, first.receiptId);
assert.equal(third.receiptId, first.receiptId);

const headers = {
  apikey: serviceRoleKey!,
  Authorization: `Bearer ${serviceRoleKey}`,
};

const receiptCountResponse = await fetch(
  `${supabaseUrl}/rest/v1/media_upload_receipts?owner_user_id=eq.${userId}&client_request_id=eq.${clientRequestId}&select=id`,
  { headers },
);
const receipts = await receiptCountResponse.json();
assert.equal(receipts.length, 1, "expected exactly one media_upload_receipts row");

const assetCountResponse = await fetch(
  `${supabaseUrl}/rest/v1/media_assets?id=eq.${first.assetId}&select=id,provider_path`,
  { headers },
);
const assets = await assetCountResponse.json();
assert.equal(assets.length, 1, "expected exactly one media_assets row");
assert.equal(assets[0].provider_path, first.path);

await assertBunnyStorageObjectExists(first.path);

console.log("Live media storage idempotency smoke passed.");
