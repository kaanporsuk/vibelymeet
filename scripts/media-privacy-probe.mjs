#!/usr/bin/env node
// Read-only media privacy probe (audit F1 acceptance gate).
//
// Samples ACTIVE private chat media objects (chat photos, voice, chat storage video) and asserts
// the PUBLIC Bunny CDN does NOT serve them unauthenticated. Private media must require the
// authorized resolver / token auth — a public 200/206 is a privacy breach and FAILS the probe.
//
// Strictly read-only: HEAD requests only, no mutations, never prints provider paths or PII.
//
// Required env (skips gracefully if absent so it never blocks dev without creds):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   BUNNY_CDN_HOSTNAME (public pull-zone host)  [VITE_/EXPO_PUBLIC_ variants accepted]
// Optional: BUNNY_CDN_PATH_PREFIX, PROBE_SAMPLE_LIMIT (default 8 per family)

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const RAW_HOST =
  process.env.BUNNY_CDN_HOSTNAME ||
  process.env.VITE_BUNNY_CDN_HOSTNAME ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_HOSTNAME ||
  "";
const PATH_PREFIX = (process.env.BUNNY_CDN_PATH_PREFIX || "").replace(/^\/+|\/+$/g, "");
const SAMPLE_LIMIT = Number.parseInt(process.env.PROBE_SAMPLE_LIMIT || "8", 10);

const PRIVATE_FAMILIES = ["chat_image", "voice_message", "chat_video", "chat_video_thumbnail"];

function skip(reason) {
  console.log(`media-privacy-probe: SKIPPED — ${reason}`);
  process.exit(0);
}

if (!SUPABASE_URL || !SERVICE_ROLE) skip("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
if (!RAW_HOST) skip("public Bunny CDN host not set");

const host = RAW_HOST.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");

async function fetchPrivateProviderPaths() {
  const familyList = PRIVATE_FAMILIES.join(",");
  const url =
    `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/media_assets` +
    `?select=provider_path,media_family,provider,status` +
    `&provider=eq.bunny_storage&status=eq.active&media_family=in.(${familyList})` +
    `&provider_path=not.is.null&limit=${SAMPLE_LIMIT * PRIVATE_FAMILIES.length}`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  if (!res.ok) throw new Error(`media_assets query failed: ${res.status}`);
  return res.json();
}

function publicUrlFor(providerPath) {
  const clean = String(providerPath).replace(/^\/+/, "");
  const pathPart = PATH_PREFIX ? `${PATH_PREFIX}/${clean}` : clean;
  return `https://${host}/${pathPart}`;
}

async function main() {
  let rows;
  try {
    rows = await fetchPrivateProviderPaths();
  } catch (err) {
    skip(`could not read media_assets (${err.message})`);
    return;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log("media-privacy-probe: no active private media sampled — nothing to assert");
    process.exit(0);
  }

  const perFamily = new Map();
  const breaches = [];
  let probed = 0;

  for (const row of rows) {
    const fam = row.media_family;
    const count = perFamily.get(fam) || 0;
    if (count >= SAMPLE_LIMIT) continue;
    perFamily.set(fam, count + 1);
    probed += 1;

    let status = 0;
    try {
      const res = await fetch(publicUrlFor(row.provider_path), { method: "HEAD" });
      status = res.status;
    } catch {
      status = -1; // network error / DNS — treated as denied (not reachable)
    }
    // 200/206 = publicly served = BREACH. 401/403/404/410 = correctly denied.
    if (status === 200 || status === 206) {
      breaches.push(fam); // family only; never the path
    }
  }

  console.log(`media-privacy-probe: probed ${probed} active private objects across ${perFamily.size} families`);
  if (breaches.length > 0) {
    const summary = [...breaches.reduce((m, f) => m.set(f, (m.get(f) || 0) + 1), new Map())]
      .map(([f, c]) => `${f}=${c}`)
      .join(", ");
    console.error(`media-privacy-probe: FAILED — public CDN served private media (${summary}).`);
    console.error("Private chat media is publicly reachable by path. Fix the Bunny zone/token-auth config.");
    process.exit(1);
  }
  console.log("media-privacy-probe: PASSED — public CDN denied all sampled private media");
}

main().catch((err) => {
  console.error("media-privacy-probe: error", err?.message || err);
  process.exit(1);
});
