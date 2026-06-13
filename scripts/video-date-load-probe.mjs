#!/usr/bin/env node
/**
 * Video Date ready-gate convoy load probe (2026-06-12, acceptance follow-up
 * round 2 / launch-readiness item).
 *
 * Drives N disposable pairs through the REAL API hot path concurrently —
 * mutual handle_swipe, then a simultaneous video_session_mark_ready_v2 storm
 * (the lane behind the 2026-06-10 57014 convoy incident) — and reports
 * latency percentiles plus error codes. This is an API-level probe: no Daily
 * media, no browsers; sessions die via the normal expiry lanes and the probe
 * cleans its own rows.
 *
 * Usage:  node scripts/video-date-load-probe.mjs [--pairs=12] [--keep]
 *
 * Safety: fresh tagged disposable users only (vd-load-<ts>, @vibely.test),
 * one disposable event, tag/pair-scoped cleanup with zero-residue check.
 * Run deliberately; this intentionally creates concurrent load on the linked
 * production project (all live data is disposable per the 2026-06-11
 * project decision).
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = "schdyxcunwcvddlcshwd";
const args = process.argv.slice(2);
const PAIRS = Number((args.find((a) => a.startsWith("--pairs=")) ?? "=12").split("=")[1]) || 12;
const KEEP = args.includes("--keep");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnvLocal() {
  const env = {};
  for (const line of fs.readFileSync(path.join(repoRoot, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return env;
}
const env = loadEnvLocal();
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const URL_ = env.VITE_SUPABASE_URL;

const token = execFileSync("bash", ["-c",
  `security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d`,
]).toString().trim();
async function sql(query) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(2000 * attempt);
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const text = await res.text();
      if (!res.ok) {
        if (res.status >= 500 || text.includes("upstream connect error")) { lastErr = new Error("transient"); continue; }
        throw new Error(`sql failed: ${text.slice(0, 300)}`);
      }
      return JSON.parse(text);
    } catch (e) {
      if (String(e.message).startsWith("sql failed")) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

async function rpc(name, body, bearer) {
  const t0 = performance.now();
  const res = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const ms = performance.now() - t0;
  let payload = null;
  try { payload = await res.json(); } catch { /* empty body */ }
  return { status: res.status, ms, payload };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

// ----------------------------------------------------------------- setup ----
const ts = String(Date.now());
const tag = `vd-load-${ts.slice(-9)}`;
// One disposable event PER PAIR: deck authority accepts a token-less handle_swipe
// only when the target is the viewer's current top deck candidate
// (event_deck_validate_presented_card NULL-token branch), so each pair gets a
// private two-person event where the partner is always the top card.
const eventIds = Array.from({ length: PAIRS }, () => crypto.randomUUID());
const eventIdList = eventIds.map((id) => `'${id}'`).join(",");
const users = [];
for (let i = 0; i < PAIRS * 2; i += 1) {
  users.push({
    id: crypto.randomUUID(),
    email: `${tag}-u${i}@vibely.test`,
    pw: crypto.randomBytes(16).toString("hex"),
    gender: i % 2 === 0 ? "man" : "woman",
    name: `Load${i}`,
  });
}
log(`setup: ${PAIRS} pairs (${users.length} users), tag ${tag}`);

const userValues = users.map((u) =>
  `('00000000-0000-0000-0000-000000000000', '${u.id}', 'authenticated', 'authenticated',
    '${u.email}', crypt('${u.pw}', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"name":"${u.name}"}', now(), now(), '', '', '', '', '', '', '', '')`).join(",\n");
const identityValues = users.map((u) =>
  `(gen_random_uuid(), '${u.id}', '${u.id}', 'email',
    jsonb_build_object('sub','${u.id}','email','${u.email}','email_verified',true), now(), now(), now())`).join(",\n");
const profileUpdates = users.map((u) => `
  UPDATE public.profiles SET
    name='${u.name}', age=30, birth_date='1996-01-15', gender='${u.gender}', interested_in='{everyone}',
    preferred_age_min=18, preferred_age_max=99, onboarding_complete=true,
    email_verified=true, verified_email='${u.email}',
    tagline='${tag} disposable load user', discoverable=true
  WHERE id='${u.id}';`).join("");
const regValues = users.map((u, i) => `('${eventIds[Math.floor(i / 2)]}', '${u.id}')`).join(",");
const eventValues = eventIds.map((id, i) =>
  `('${id}', '${tag} Load Probe Event P${i + 1}', 'Disposable load-probe event. Safe to delete.',
    '/placeholder.svg', now() - interval '5 minutes', 180, 12, 'live', 'all', true, false)`).join(",\n");

await sql(`
DO $$
BEGIN
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token)
  VALUES ${userValues};
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  VALUES ${identityValues};
  PERFORM set_config('vibely.onboarding_server_update','1',true);
  PERFORM set_config('vibely.verification_server_update','1',true);
  ${profileUpdates}
  INSERT INTO public.notification_preferences (user_id)
  SELECT u.id FROM unnest(ARRAY[${users.map((u) => `'${u.id}'`).join(",")}]::uuid[]) AS u(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = u.id);
  INSERT INTO public.events (id, title, description, cover_image, event_date, duration_minutes, max_attendees,
    status, visibility, is_free, is_test_event)
  VALUES ${eventValues};
  INSERT INTO public.event_registrations (event_id, profile_id) VALUES ${regValues};
END $$;`);
log("fixtures created");

// --------------------------------------------------------------- the run ----
const report = { tag, pairs: PAIRS, swipe: [], markReady: [], errors: {} };
const recordError = (stage, status, payload) => {
  const code = payload?.code ?? payload?.error_code ?? payload?.message?.slice(0, 60) ?? `http_${status}`;
  const key = `${stage}:${code}`;
  report.errors[key] = (report.errors[key] ?? 0) + 1;
};

async function signIn(u) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await sleep(1500 * attempt);
    const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: u.email, password: u.pw }),
    });
    if (res.ok) { u.token = (await res.json()).access_token; return; }
    lastErr = new Error(`signin failed for user ${u.id.slice(0, 8)}… (http ${res.status})`);
    if (res.status !== 429 && res.status < 500) throw lastErr; // non-rate-limit auth error: don't retry
  }
  throw lastErr;
}

// IMPORTANT: signin lives inside the try so the finally-block cleanup runs even
// when auth rate-limits or a transient kills it mid-setup (otherwise fixtures orphan).
try {
  log("signing in", users.length, "users…");
  // Bounded concurrency (chunks of 6) keeps the auth password-grant endpoint under
  // its burst rate limit at higher --pairs counts.
  for (let i = 0; i < users.length; i += 6) {
    await Promise.all(users.slice(i, i + 6).map(signIn));
    if (i + 6 < users.length) await sleep(250);
  }
  log("all signed in");

  // Phase 1: concurrent mutual swipes (pair i = users[2i], users[2i+1])
  log("phase 1: concurrent mutual swipes across all pairs");
  await Promise.all(Array.from({ length: PAIRS }, async (_, i) => {
    const a = users[2 * i];
    const b = users[2 * i + 1];
    // Faithful client hot path: fetch the deck (get_event_deck_v3 builds the
    // card reservations + per-card deck_token), then swipe the partner card with
    // its token through handle_swipe_v2 (the authenticated-granted entrypoint the
    // real swipe-actions Edge invokes; plain handle_swipe is service_role-only).
    const pairEventId = eventIds[i];
    const [deckA, deckB] = await Promise.all([
      rpc("get_event_deck_v3", { p_event_id: pairEventId, p_user_id: a.id, p_limit: 20 }, a.token),
      rpc("get_event_deck_v3", { p_event_id: pairEventId, p_user_id: b.id, p_limit: 20 }, b.token),
    ]);
    const tokenFor = (deck, partnerId) =>
      (deck.payload?.profiles ?? []).find((p) => p.profile_id === partnerId)?.deck_token ?? null;
    const tokenA = tokenFor(deckA, b.id);
    const tokenB = tokenFor(deckB, a.id);
    // PII-safe diagnostic: never persist raw deck profiles into the report.
    if (i === 0) report.deckSample = {
      tokenA: Boolean(tokenA),
      tokenB: Boolean(tokenB),
      deck_state: deckA.payload?.deck_state ?? deckA.payload?.ok ?? null,
      deck_profile_count: (deckA.payload?.profiles ?? []).length,
    };

    const r1 = await rpc("handle_swipe_v2",
      { p_event_id: pairEventId, p_actor_id: a.id, p_target_id: b.id, p_swipe_type: "vibe", p_deck_token: tokenA }, a.token);
    report.swipe.push(r1.ms);
    if (i === 0) report.swipeSample = { r1: r1.payload };
    if (r1.status !== 200) recordError("swipe", r1.status, r1.payload);
    const r2 = await rpc("handle_swipe_v2",
      { p_event_id: pairEventId, p_actor_id: b.id, p_target_id: a.id, p_swipe_type: "vibe", p_deck_token: tokenB }, b.token);
    report.swipe.push(r2.ms);
    if (i === 0) report.swipeSample.r2 = r2.payload;
    if (r2.status !== 200) recordError("swipe", r2.status, r2.payload);
  }));

  if (report.swipeSample) {
    log("swipe sample:", JSON.stringify({
      tokenA_present: report.deckSample?.tokenA,
      deck_profile_count: report.deckSample?.deck_profile_count,
      r1_result: report.swipeSample.r1?.result ?? report.swipeSample.r1?.outcome,
      r2_result: report.swipeSample.r2?.result ?? report.swipeSample.r2?.outcome,
    }));
  }

  const sessions = await sql(`select id, participant_1_id, participant_2_id
    from public.video_sessions where event_id in (${eventIdList})`);
  log(`sessions created: ${sessions.length}/${PAIRS}`);
  if (sessions.length === 0) throw new Error("no sessions created — aborting probe");

  // Phase 2: the convoy — every participant marks ready at the same moment
  log("phase 2: simultaneous mark_ready storm —", sessions.length * 2, "concurrent calls");
  const byId = new Map(users.map((u) => [u.id, u]));
  const calls = [];
  for (const s of sessions) {
    for (const pid of [s.participant_1_id, s.participant_2_id]) {
      const u = byId.get(pid);
      calls.push(async () => {
        const r = await rpc("video_session_mark_ready_v2",
          { p_session_id: s.id, p_idempotency_key: crypto.randomUUID() }, u.token);
        report.markReady.push(r.ms);
        if (r.status !== 200 || r.payload?.success === false) recordError("mark_ready", r.status, r.payload);
      });
    }
  }
  await Promise.all(calls.map((fn) => fn()));

  await sleep(4000);
  const states = await sql(`select ready_gate_status, count(*)::int n
    from public.video_sessions where event_id in (${eventIdList}) group by 1`);
  report.readyGateStates = states;

  const sw = [...report.swipe].sort((x, y) => x - y);
  const mr = [...report.markReady].sort((x, y) => x - y);
  report.summary = {
    swipe: { n: sw.length, p50: Math.round(pct(sw, 50)), p95: Math.round(pct(sw, 95)), max: Math.round(sw[sw.length - 1] ?? 0) },
    mark_ready: { n: mr.length, p50: Math.round(pct(mr, 50)), p95: Math.round(pct(mr, 95)), max: Math.round(mr[mr.length - 1] ?? 0) },
    error_57014: Object.entries(report.errors).filter(([k]) => k.includes("57014")).reduce((acc, [, v]) => acc + v, 0),
    errors: report.errors,
    both_ready: states.find((s) => s.ready_gate_status === "both_ready")?.n ?? 0,
    sessions: sessions.length,
  };
  log("RESULT:", JSON.stringify(report.summary));
} finally {
  if (!KEEP) {
    log("cleanup…");
    const ids = users.map((u) => `'${u.id}'`).join(",");
    const steps = [
      `delete from public.date_feedback where user_id in (${ids})`,
      `delete from public.matches where profile_id_1 in (${ids}) or profile_id_2 in (${ids})`,
      `delete from public.video_date_daily_webhook_events where session_id in (select id from public.video_sessions where event_id in (${eventIdList}))`,
      `delete from public.video_date_presence_events where session_id in (select id from public.video_sessions where event_id in (${eventIdList}))`,
      `delete from public.video_date_provider_outbox where session_id in (select id from public.video_sessions where event_id in (${eventIdList}))`,
      `delete from public.video_date_provider_outbox_failure_log where session_id in (select id from public.video_sessions where event_id in (${eventIdList}))`,
      `delete from public.video_session_deadlines where session_id in (select id from public.video_sessions where event_id in (${eventIdList}))`,
      `delete from public.event_loop_observability_events where event_id in (${eventIdList})`,
      `delete from public.video_sessions where event_id in (${eventIdList})`,
      `delete from public.event_deck_card_reservations where event_id in (${eventIdList})`,
      `delete from public.event_profile_impressions where event_id in (${eventIdList})`,
      `delete from public.event_swipes where event_id in (${eventIdList})`,
      `delete from public.event_registrations where event_id in (${eventIdList})`,
      `delete from public.events where id in (${eventIdList}) and title like 'vd-load-%'`,
      `delete from public.notification_preferences where user_id in (${ids})`,
      `delete from public.profiles where id in (${ids}) and tagline like 'vd-load-%'`,
      `delete from auth.identities where user_id in (${ids})`,
      `delete from auth.users where id in (${ids}) and email like 'vd-load-%@vibely.test'`,
    ];
    for (const q of steps) { try { await sql(q); } catch (e) { log("cleanup err:", e.message.slice(0, 120)); } }
    const residue = await sql(`select
      (select count(*) from auth.users where id in (${ids})) au,
      (select count(*) from public.profiles where id in (${ids})) p,
      (select count(*) from public.events where id in (${eventIdList})) e,
      (select count(*) from public.video_sessions where event_id in (${eventIdList})) vs`);
    log("zero-residue:", JSON.stringify(residue[0]));
  } else {
    log("--keep set: fixtures retained for inspection; clean up manually");
  }
  fs.writeFileSync(path.join(repoRoot, ".live-gate-load-report.json"), JSON.stringify(report, null, 2));
}
