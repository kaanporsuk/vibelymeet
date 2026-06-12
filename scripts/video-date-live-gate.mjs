#!/usr/bin/env node
/**
 * Video Date two-user live gate — the program acceptance bar as a runnable
 * artifact (committed 2026-06-12 after three /tmp rebuilds of the same
 * technique caught real bugs; see docs/video-date-runbook.md "Smoke
 * procedure" and the acceptance-run reports).
 *
 * Usage:
 *   node scripts/video-date-live-gate.mjs all [flags]      # setup + run + cleanup
 *   node scripts/video-date-live-gate.mjs setup
 *   node scripts/video-date-live-gate.mjs run [flags]
 *   node scripts/video-date-live-gate.mjs cleanup
 *
 * Flags for run/all:
 *   --offline-drop=SECONDS   mid-date transport drop on user B (default off)
 *   --revisit-check          post-survey dead-session revisit must not re-stamp partner
 *   --stale-stamp-check      staged stale in_survey must self-heal in one visit
 *
 * Requirements:
 *   - Vite dev server on http://127.0.0.1:5173 (npx vite --port 5173 --strictPort)
 *   - .env.local with VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
 *   - Supabase CLI login in the macOS keychain (management-API SQL channel)
 *   - npx playwright install chromium (once)
 *
 * Safety: creates ONLY fresh tagged disposable fixtures (vd-gate-<ts>,
 * @vibely.test emails); cleanup is tag/pair/session-scoped with zero-residue
 * verification; secrets live in a 0600 work dir and are shredded on success.
 * PII/tokens are never printed.
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_DIR = process.env.VD_LIVE_GATE_DIR ?? path.join(repoRoot, ".live-gate");
const BASE = process.env.VD_LIVE_GATE_BASE_URL ?? "http://127.0.0.1:5173";
const PROJECT_REF = "schdyxcunwcvddlcshwd";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnvLocal() {
  const env = {};
  const text = fs.readFileSync(path.join(repoRoot, ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(".env.local must provide VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY");
  }
  return env;
}

function mgmtToken() {
  return execFileSync("bash", ["-c",
    `security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d`,
  ]).toString().trim();
}

let _token = null;
async function sql(query) {
  _token ??= mgmtToken();
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(2000 * attempt);
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const text = await res.text();
      if (!res.ok) {
        if (res.status >= 500 || text.includes("upstream connect error")) {
          lastErr = new Error(`sql transient ${res.status}`);
          continue;
        }
        throw new Error(`sql failed: ${text.slice(0, 400)}`);
      }
      return JSON.parse(text);
    } catch (e) {
      if (String(e.message).startsWith("sql failed")) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

async function pollSql(label, query, predicate, timeoutMs, intervalMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await sql(query);
    if (predicate(last)) return last;
    await sleep(intervalMs);
  }
  throw new Error(`pollSql timeout: ${label} — last: ${JSON.stringify(last).slice(0, 400)}`);
}

const credsPath = () => path.join(WORK_DIR, "creds.json");
const statePath = (label) => path.join(WORK_DIR, `state-${label}.json`);
const resultsPath = () => path.join(WORK_DIR, "results.json");
const loadCreds = () => JSON.parse(fs.readFileSync(credsPath(), "utf8"));

// ---------------------------------------------------------------- setup ----
async function setup() {
  fs.mkdirSync(WORK_DIR, { recursive: true, mode: 0o700 });
  const ts = String(Date.now());
  const tag = `vd-gate-${ts.slice(-9)}`;
  const uuid = () => crypto.randomUUID();
  const creds = {
    tag, idA: uuid(), idB: uuid(), eventId: uuid(),
    emailA: `${tag}-a@vibely.test`, emailB: `${tag}-b@vibely.test`,
    pwA: crypto.randomBytes(16).toString("hex"), pwB: crypto.randomBytes(16).toString("hex"),
  };
  const profile = (id, name, gender, email, label) => `
  UPDATE public.profiles SET
    name='${name}', age=${gender === "man" ? 30 : 31},
    birth_date='${gender === "man" ? "1996-01-15" : "1995-03-20"}',
    gender='${gender}', interested_in='{everyone}',
    preferred_age_min=18, preferred_age_max=99, onboarding_complete=true,
    email_verified=true, verified_email='${email}',
    tagline='${tag} disposable live-gate user ${label}', discoverable=true
  WHERE id='${id}';`;
  await sql(`
DO $$
BEGIN
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token)
  VALUES
    ('00000000-0000-0000-0000-000000000000', '${creds.idA}', 'authenticated', 'authenticated',
     '${creds.emailA}', crypt('${creds.pwA}', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"name":"GateA"}', now(), now(), '', '', '', '', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', '${creds.idB}', 'authenticated', 'authenticated',
     '${creds.emailB}', crypt('${creds.pwB}', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"name":"GateB"}', now(), now(), '', '', '', '', '', '', '', '');
  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  VALUES
    (gen_random_uuid(), '${creds.idA}', '${creds.idA}', 'email',
     jsonb_build_object('sub','${creds.idA}','email','${creds.emailA}','email_verified',true), now(), now(), now()),
    (gen_random_uuid(), '${creds.idB}', '${creds.idB}', 'email',
     jsonb_build_object('sub','${creds.idB}','email','${creds.emailB}','email_verified',true), now(), now(), now());
  PERFORM set_config('vibely.onboarding_server_update','1',true);
  PERFORM set_config('vibely.verification_server_update','1',true);
  ${profile(creds.idA, "GateA", "man", creds.emailA, "A")}
  ${profile(creds.idB, "GateB", "woman", creds.emailB, "B")}
  INSERT INTO public.notification_preferences (user_id)
  SELECT u.id FROM (VALUES ('${creds.idA}'::uuid), ('${creds.idB}'::uuid)) AS u(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = u.id);
  INSERT INTO public.events (id, title, description, cover_image, event_date, duration_minutes, max_attendees,
    status, visibility, is_free, is_test_event)
  VALUES ('${creds.eventId}', '${tag} Live Gate Event', 'Disposable live-gate event. Safe to delete.',
    '/placeholder.svg', now() - interval '5 minutes', 180, 50, 'live', 'all', true, false);
  INSERT INTO public.event_registrations (event_id, profile_id)
  VALUES ('${creds.eventId}', '${creds.idA}'), ('${creds.eventId}', '${creds.idB}');
END $$;`);
  const elig = await sql(`select
    (public.event_deck_candidate_eligibility('${creds.eventId}'::uuid,'${creds.idA}'::uuid,'${creds.idB}'::uuid,true,true)->>'ok') a,
    (public.event_deck_candidate_eligibility('${creds.eventId}'::uuid,'${creds.idB}'::uuid,'${creds.idA}'::uuid,true,true)->>'ok') b`);
  if (elig[0].a !== "true" || elig[0].b !== "true") throw new Error("fixture pair not mutually deck-eligible");

  const env = loadEnvLocal();
  const storageKey = `sb-${env.VITE_SUPABASE_PROJECT_ID ?? PROJECT_REF}-auth-token`;
  const signIn = async (email, password) => {
    const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`signin failed ${res.status}`);
    return body;
  };
  const a = await signIn(creds.emailA, creds.pwA);
  const b = await signIn(creds.emailB, creds.pwB);
  for (const [label, sess] of [["a", a], ["b", b]]) {
    fs.writeFileSync(statePath(label), JSON.stringify({
      cookies: [],
      origins: [{ origin: BASE, localStorage: [
        { name: storageKey, value: JSON.stringify(sess) },
        { name: "vibely.analytics_consent.v1", value: "granted" },
      ]}],
    }), { mode: 0o600 });
  }
  fs.writeFileSync(credsPath(), JSON.stringify(creds), { mode: 0o600 });
  log("setup complete — tag:", tag, "users:", creds.idA.slice(0, 8) + "…", creds.idB.slice(0, 8) + "…");
  return creds;
}

// ------------------------------------------------------------------ run ----
async function run(flags) {
  const creds = loadCreds();
  const results = { tag: creds.tag, checkpoints: [], timings: {}, startedAt: new Date().toISOString() };
  const check = (name, pass, detail) => {
    results.checkpoints.push({ name, pass, detail });
    log(pass ? "PASS" : "FAIL", "—", name, detail ? JSON.stringify(detail).slice(0, 240) : "");
  };
  const pair = `('${creds.idA}','${creds.idB}')`;
  const SESSION_Q = `select id, state::text as state, ready_gate_status, date_started_at, ended_at, ended_reason
    from public.video_sessions
    where event_id='${creds.eventId}' and participant_1_id in ${pair} and participant_2_id in ${pair}
    order by started_at desc limit 1`;
  const QS_Q = `select profile_id, queue_status, current_room_id from public.event_registrations
    where event_id='${creds.eventId}' order by profile_id`;

  const ping = await fetch(BASE).catch(() => null);
  if (!ping?.ok) throw new Error(`dev server not reachable at ${BASE} — start it: npx vite --port 5173 --strictPort`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required"],
  });
  const mk = async (label) => {
    const ctx = await browser.newContext({
      baseURL: BASE, storageState: statePath(label),
      permissions: ["camera", "microphone"], viewport: { width: 420, height: 850 },
    });
    return { ctx, page: await ctx.newPage() };
  };
  const clickFirst = async (page, label, patterns, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const pattern of patterns) {
        const btn = page.getByRole("button", { name: pattern }).first();
        try {
          if (await btn.isVisible({ timeout: 400 })) {
            await btn.click({ timeout: 3000 });
            return true;
          }
        } catch { /* keep scanning */ }
      }
      await sleep(700);
    }
    return false;
  };

  const A = await mk("a");
  const B = await mk("b");
  try {
    // golden flow
    const lobbyUrl = `${BASE}/event/${creds.eventId}/lobby`;
    await Promise.all([A.page.goto(lobbyUrl, { timeout: 60000 }), B.page.goto(lobbyUrl, { timeout: 60000 })]);
    await sleep(6000);
    if (!(await clickFirst(A.page, "swipe-a", [/^vibe$/i], 45000)
        && await clickFirst(B.page, "swipe-b", [/^vibe$/i], 45000))) throw new Error("swipe failed");
    const sess = await pollSql("session row", SESSION_Q, (r) => r.length > 0, 60000);
    results.sessionId = sess[0].id;
    const SID = sess[0].id;
    await sleep(2500);
    if (!(await clickFirst(A.page, "ready-a", [/mark ready/i], 60000)
        && await clickFirst(B.page, "ready-b", [/mark ready/i], 60000))) throw new Error("mark ready failed");
    await Promise.all([
      A.page.waitForURL(/\/date\//, { timeout: 120000 }),
      B.page.waitForURL(/\/date\//, { timeout: 120000 }),
    ]);
    await pollSql("date promotion", SESSION_Q, (r) => r[0]?.date_started_at, 180000, 3000);
    await sleep(4000);

    if (flags.offlineDropSeconds > 0) {
      const before = await sql(`select array_agg(distinct provider_participant_id) pids
        from public.video_date_daily_webhook_events
        where session_id='${SID}' and event_type='participant.joined'`);
      log(`transport drop: B offline ${flags.offlineDropSeconds}s`);
      await B.ctx.setOffline(true);
      await sleep(flags.offlineDropSeconds * 1000);
      await B.ctx.setOffline(false);
      await sleep(15000);
      const mid = await sql(SESSION_Q);
      const after = await sql(`select array_agg(distinct provider_participant_id) pids
        from public.video_date_daily_webhook_events
        where session_id='${SID}' and event_type='participant.joined'`);
      check("transport drop honored (no false terminal)",
        mid[0].state === "date" && !mid[0].ended_at,
        { state: mid[0].state, pids_before: before[0].pids?.length, pids_after: after[0].pids?.length });
    }

    // End is retried as a unit (click + confirm dialog) until the server row
    // goes terminal — after a mid-date transport drop the first attempt can be
    // swallowed by the reconnect re-render.
    let ended = null;
    for (let endAttempt = 0; endAttempt < 4 && !ended; endAttempt += 1) {
      await clickFirst(A.page, "end-a", [/end date/i, /end call/i], 20000);
      await sleep(1200);
      const dialog = A.page.locator('[role="alertdialog"], [role="dialog"]');
      if (await dialog.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await dialog.getByRole("button", { name: /end/i }).first().click({ timeout: 5000 }).catch(() => {});
      }
      ended = await pollSql("ended", SESSION_Q, (r) => r[0]?.ended_at, 20000).catch(() => null);
    }
    if (!ended) throw new Error("end date never reached terminal after retries");
    await sleep(3000);
    await clickFirst(A.page, "verdict-a", [/vibe with/i], 45000);
    await clickFirst(B.page, "verdict-b", [/vibe with/i], 45000);
    const fb = await pollSql("2 feedback rows",
      `select count(*)::int n from public.date_feedback where session_id='${SID}'`,
      (r) => r[0].n === 2, 90000);
    const fbDoneAt = new Date().toISOString();
    check("golden flow: 2 persisted date_feedback rows, ended_from_client",
      fb[0].n === 2 && ended[0].ended_reason === "ended_from_client",
      { feedback: fb[0].n, ended_reason: ended[0].ended_reason });

    // release both through the real flow
    await Promise.all([
      A.page.goto(lobbyUrl).catch(() => {}),
      B.page.goto(lobbyUrl).catch(() => {}),
    ]);
    {
      const deadline = Date.now() + 90000;
      let released = false;
      while (Date.now() < deadline) {
        const rows = await sql(QS_Q);
        if (rows.length === 2 && rows.every((r) => r.queue_status !== "in_survey")) { released = true; break; }
        for (const P of [A, B]) {
          await clickFirst(P.page, "release",
            [/leave/i, /keep the vibe/i, /back to (the )?lobby/i, /^continue$/i, /done/i], 1500).catch(() => {});
        }
        await sleep(2500);
      }
      check("post-survey release through real flow (both users)", released,
        { statuses: (await sql(QS_Q)).map((r) => r.queue_status) });
    }

    if (flags.revisitCheck) {
      await B.page.goto("about:blank").catch(() => {});
      await A.page.goto(`${BASE}/date/${SID}`, { timeout: 60000 });
      await sleep(12000);
      await clickFirst(A.page, "revisit-leave", [/leave/i], 4000).catch(() => {});
      await sleep(6000);
      const bRow = (await sql(QS_Q)).find((r) => r.profile_id === creds.idB);
      const restamps = await sql(`select count(*)::int n from public.event_loop_observability_events
        where event_id='${creds.eventId}' and reason_code='terminal_confirmed_encounter_survey'
          and created_at > '${fbDoneAt}'`);
      check("revisit-check: dead-session revisit does not re-stamp partner",
        bRow.queue_status !== "in_survey" && restamps[0].n === 0,
        { b_queue: bRow.queue_status, restamps_after_fb: restamps[0].n });
    }

    if (flags.staleStampCheck) {
      await A.page.goto("about:blank").catch(() => {});
      await sql(`update public.event_registrations
        set queue_status='in_survey', current_room_id='${SID}'
        where event_id='${creds.eventId}' and profile_id='${creds.idB}'`);
      // Fresh context: B's reused page can be left non-booting after the
      // offline-drop + about:blank churn (observed 2026-06-12: zero
      // server-visible activity); a real user re-opening the app is a fresh
      // load anyway.
      await B.ctx.close().catch(() => {});
      const B2 = await mk("b");
      const dateNavTimes = [];
      B2.page.on("framenavigated", (f) => {
        if (f === B2.page.mainFrame() && f.url().includes("/date/")) dateNavTimes.push(Date.now());
      });
      B2.page.on("pageerror", (e) => log("stale-check pageerror:", String(e).slice(0, 160)));
      await B2.page.goto(lobbyUrl, { timeout: 60000 });
      const t0 = Date.now();
      let healed = false;
      while (Date.now() - t0 < 60000) {
        const b = (await sql(QS_Q)).find((r) => r.profile_id === creds.idB);
        if (b.queue_status !== "in_survey") { healed = true; break; }
        await sleep(2000);
      }
      await sleep(10000);
      const settledMs = dateNavTimes.length ? Date.now() - dateNavTimes[dateNavTimes.length - 1] : -1;
      const pass = healed && dateNavTimes.length <= 2 && settledMs > 8000;
      if (!pass) {
        await B2.page.screenshot({ path: path.join(WORK_DIR, "stale-check-fail.png") }).catch(() => {});
        log("stale-check failure url:", B2.page.url());
      }
      check("stale-stamp-check: one-visit self-heal, no ping-pong", pass,
        { healMs: healed ? Date.now() - t0 : null, dateNavs: dateNavTimes.length, settledMs });
      await B2.ctx.close().catch(() => {});
    }

    const pids = await sql(`select count(distinct provider_participant_id)
        filter (where provider_participant_id is not null)::int n
      from public.video_date_daily_webhook_events
      where session_id='${SID}' and event_type='participant.joined'`);
    check("webhook ledger: bilateral non-null provider_participant_id", pids[0].n >= 2, pids[0]);
    const fg = await sql(`select count(*)::int n from public.event_loop_observability_events
      where event_id='${creds.eventId}' and operation='mark_lobby_foreground'`);
    check("mark_lobby_foreground volume throttled", fg[0].n < 30, { rows: fg[0].n });
  } finally {
    results.finishedAt = new Date().toISOString();
    fs.writeFileSync(resultsPath(), JSON.stringify(results, null, 2), { mode: 0o600 });
    await A.ctx.close().catch(() => {});
    await B.ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  const failed = results.checkpoints.filter((c) => !c.pass);
  log(failed.length === 0 ? "LIVE GATE PASSED" : `${failed.length} CHECKPOINT(S) FAILED`);
  if (failed.length > 0) throw new Error("live gate failed — fixtures kept for forensics; run cleanup manually");
}

// -------------------------------------------------------------- cleanup ----
async function cleanup() {
  const creds = loadCreds();
  const results = fs.existsSync(resultsPath()) ? JSON.parse(fs.readFileSync(resultsPath(), "utf8")) : {};
  const pair = `('${creds.idA}','${creds.idB}')`;
  const SID = results.sessionId ?? null;
  const sessionScoped = SID ? [
    ["date_feedback", `delete from public.date_feedback where session_id='${SID}' and user_id in ${pair} returning 1`],
    ["webhook_events", `delete from public.video_date_daily_webhook_events where session_id='${SID}' returning 1`],
    ["presence_events", `delete from public.video_date_presence_events where session_id='${SID}' returning 1`],
    ["outbox", `delete from public.video_date_provider_outbox where session_id='${SID}' returning 1`],
    ["outbox_failures", `delete from public.video_date_provider_outbox_failure_log where session_id='${SID}' returning 1`],
    ["orphan_audit", `delete from public.video_date_orphan_room_cleanup_audit where session_id='${SID}' returning 1`],
  ] : [];
  const steps = [
    ...sessionScoped,
    ["matches", `delete from public.matches where event_id='${creds.eventId}' and profile_id_1 in ${pair} and profile_id_2 in ${pair} returning 1`],
    ["observability", `delete from public.event_loop_observability_events where event_id='${creds.eventId}' returning 1`],
    ["video_sessions", `delete from public.video_sessions where event_id='${creds.eventId}' and participant_1_id in ${pair} and participant_2_id in ${pair} returning 1`],
    ["deck_reservations", `delete from public.event_deck_card_reservations where event_id='${creds.eventId}' returning 1`],
    ["impressions", `delete from public.event_profile_impressions where event_id='${creds.eventId}' returning 1`],
    ["swipes", `delete from public.event_swipes where event_id='${creds.eventId}' returning 1`],
    ["registrations", `delete from public.event_registrations where event_id='${creds.eventId}' and profile_id in ${pair} returning 1`],
    ["events", `delete from public.events where id='${creds.eventId}' and title like 'vd-gate-%' returning 1`],
    ["notification_prefs", `delete from public.notification_preferences where user_id in ${pair} returning 1`],
    ["profiles", `delete from public.profiles where id in ${pair} and tagline like 'vd-gate-%' returning 1`],
    ["auth_identities", `delete from auth.identities where user_id in ${pair} returning 1`],
    ["auth_users", `delete from auth.users where id in ${pair} and email like '%@vibely.test' and email like 'vd-gate-%' returning 1`],
  ];
  for (const [name, q] of steps) {
    try { log(name.padEnd(20), (await sql(q)).length); }
    catch (e) { log(name.padEnd(20), "ERROR:", e.message.slice(0, 160)); }
  }
  const residue = await sql(`select
    (select count(*) from auth.users where id in ${pair}) au,
    (select count(*) from public.profiles where id in ${pair}) p,
    (select count(*) from public.events where id='${creds.eventId}') e,
    (select count(*) from public.event_registrations where event_id='${creds.eventId}' or profile_id in ${pair}) reg,
    (select count(*) from public.video_sessions where participant_1_id in ${pair} or participant_2_id in ${pair}) vs,
    (select count(*) from public.date_feedback where user_id in ${pair}) fb,
    (select count(*) from public.matches where profile_id_1 in ${pair} or profile_id_2 in ${pair}) m`);
  const clean = Object.values(residue[0]).every((v) => Number(v) === 0);
  log("zero-residue:", clean ? "OK" : `RESIDUE ${JSON.stringify(residue[0])}`);
  if (clean) {
    fs.rmSync(WORK_DIR, { recursive: true, force: true });
    log("work dir shredded");
  } else {
    throw new Error("residue detected — investigate before deleting work dir");
  }
}

// ----------------------------------------------------------------- main ----
const [, , command = "all", ...rest] = process.argv;
const flags = {
  offlineDropSeconds: Number((rest.find((a) => a.startsWith("--offline-drop=")) ?? "=0").split("=")[1]) || 0,
  revisitCheck: rest.includes("--revisit-check"),
  staleStampCheck: rest.includes("--stale-stamp-check"),
};
try {
  if (command === "setup") await setup();
  else if (command === "run") await run(flags);
  else if (command === "cleanup") await cleanup();
  else if (command === "all") {
    await setup();
    await run(flags);
    await cleanup();
  } else throw new Error(`unknown command: ${command}`);
} catch (e) {
  console.error("LIVE GATE ERROR:", e.message);
  process.exit(1);
}
