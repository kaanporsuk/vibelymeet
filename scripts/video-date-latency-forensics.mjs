#!/usr/bin/env node
/**
 * Video Date connect-latency forensics (post-run triage).
 *
 * Given a session id (or, with no arg, the most recent session that reached a
 * date), prints the ready -> date latency budget with provider-backed
 * copresence and surface-claim evidence, so a two-user test run can be
 * localized in one command instead of pasting Network/Console logs.
 *
 * What it can show (all server-side truth):
 *   - ready -> both-joined-Daily (prewarm/join cost)
 *   - both-joined -> entry_started (entry-transition lag)
 *   - entry_started -> date_started (stable bilateral media gate)
 *   - the dominant gap, called out explicitly
 *   - Daily webhook copresence (provider join order + webhook processing lag)
 *   - first surface claim per actor (proves both clients reached /date)
 *
 * What it CANNOT show: the sub-breakdown of the join->first-remote-frame
 * window (Daily subscription vs. decode vs. play()). That lives only in the
 * client `first_remote_frame` / `daily_prewarm_consumed` / `media_handoff_used`
 * PostHog checkpoints. When that window dominates, pull those events.
 *
 * Read-only; uses the keychain management-API SQL channel (never prints the
 * token). Deliberately NOT part of the static battery (needs live access):
 *   npm run latency:video-date [sessionId]
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load gitignored local env files so POSTHOG_* can live in .env.local instead of
// the keychain. These must NOT use the VITE_ prefix (VITE_ vars are bundled into
// the client app); a personal API key belongs only in this server-side tool.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const envFile of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(repoRoot, envFile));
  } catch {
    /* file absent or unparseable — fall back to process env / keychain */
  }
}

const PROJECT_REF = "schdyxcunwcvddlcshwd";
const sessionArg = process.argv[2]?.trim() || null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value, label) {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
  return value.toLowerCase();
}

const validatedSessionArg = sessionArg ? requireUuid(sessionArg, "session id") : null;

const token = execFileSync("bash", [
  "-c",
  `security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d`,
])
  .toString()
  .trim();

// PostHog read credentials (optional). Resolved from env first, then the macOS
// keychain (store once, mirrors how the Supabase CLI token lives there). When
// present, the client first_remote_frame / checkpoint timeline is appended so a
// run is localized in one command. The API host is the regional APP host
// (https://eu.posthog.com) — NOT the eu.i.posthog.com ingestion host.
function keychain(service) {
  try {
    return execFileSync("bash", ["-c", `security find-generic-password -s ${JSON.stringify(service)} -w`])
      .toString()
      .trim();
  } catch {
    return null;
  }
}
const POSTHOG = {
  key: process.env.POSTHOG_PERSONAL_API_KEY || keychain("PostHog Personal API"),
  projectId: process.env.POSTHOG_PROJECT_ID || keychain("PostHog Project ID"),
  host: (process.env.POSTHOG_HOST || "https://eu.posthog.com").replace(/\/$/, ""),
};

async function sql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(`sql failed: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

const sec = (a, b) => {
  if (!a || !b) return null;
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 100) / 10;
};
const fmt = (n) => (n == null ? "  n/a" : `${n >= 0 ? " " : ""}${n.toFixed(1)}s`);

async function resolveSessionId() {
  if (validatedSessionArg) return validatedSessionArg;
  const rows = await sql(`
    select id from video_sessions
    where date_started_at is not null
    order by started_at desc nulls last limit 1`);
  if (rows.length === 0) {
    throw new Error("no session with date_started_at found; pass a session id explicitly");
  }
  return requireUuid(rows[0].id, "resolved session id");
}

const sid = await resolveSessionId();
const room = `date-${sid.replace(/-/g, "")}`;

const [s] = await sql(`
  select state, phase, ended_reason, started_at, ended_at, duration_seconds, session_seq,
    participant_1_id, participant_2_id,
    entry_started_at, date_started_at, ready_participant_1_at, ready_participant_2_at,
    participant_1_provider_joined_at, participant_2_provider_joined_at,
    participant_1_remote_seen_at, participant_2_remote_seen_at,
    stable_bilateral_media_at, stable_bilateral_media_source, daily_room_verified_at
  from video_sessions where id = '${sid}'`);

if (!s) {
  console.error(`session ${sid} not found`);
  process.exit(1);
}

const bothReady = s.ready_participant_1_at && s.ready_participant_2_at
  ? (new Date(s.ready_participant_1_at) > new Date(s.ready_participant_2_at)
      ? s.ready_participant_1_at
    : s.ready_participant_2_at)
  : null;

const webhook = await sql(`
  select event_type, occurred_at, processed_at, provider_user_id,
    round(extract(epoch from (processed_at - occurred_at))::numeric, 2) webhook_lag_s
  from video_date_daily_webhook_events
  where session_id = '${sid}' or room_name = '${room}'
  order by coalesce(occurred_at, created_at) asc`);
const firstJoinByActor = new Map();
for (const w of webhook) {
  const eventType = String(w.event_type ?? "").replace(/[_-]/g, ".").toLowerCase();
  if (eventType !== "participant.joined" && eventType !== "participant.join") {
    continue;
  }
  const actorId = String(w.provider_user_id ?? "");
  if (actorId !== s.participant_1_id && actorId !== s.participant_2_id) {
    continue;
  }
  const joinedAt = w.occurred_at ?? w.processed_at ?? null;
  if (!joinedAt) continue;
  const previous = firstJoinByActor.get(actorId);
  if (!previous || new Date(joinedAt).getTime() < new Date(previous).getTime()) {
    firstJoinByActor.set(actorId, joinedAt);
  }
}
const participant1FirstProviderJoin = s.participant_1_id
  ? firstJoinByActor.get(s.participant_1_id) ?? null
  : null;
const participant2FirstProviderJoin = s.participant_2_id
  ? firstJoinByActor.get(s.participant_2_id) ?? null
  : null;
const bothJoined =
  participant1FirstProviderJoin && participant2FirstProviderJoin
    ? (new Date(participant1FirstProviderJoin) > new Date(participant2FirstProviderJoin)
        ? participant1FirstProviderJoin
        : participant2FirstProviderJoin)
    : null;

const legs = [
  ["session open -> both ready (tap)", sec(bothReady, s.started_at)],
  ["both ready -> both joined Daily ", sec(bothJoined, bothReady)],
  ["both joined -> entry_started    ", sec(s.entry_started_at, bothJoined)],
  ["entry_started -> date_started   ", sec(s.date_started_at, s.entry_started_at)],
];
const total = sec(s.date_started_at, bothReady);

console.log(`\n=== Video Date latency forensics: ${sid} (seq ${s.session_seq}) ===`);
console.log(`state=${s.state}/${s.phase}  ended_reason=${s.ended_reason ?? "—"}  duration=${s.duration_seconds ?? "—"}s`);
console.log(`stable_bilateral_media_source=${s.stable_bilateral_media_source ?? "—"}`);
console.log(`\n  leg                                  cost`);
console.log(`  -----------------------------------  -----`);
let worst = { label: null, cost: -1 };
for (const [label, cost] of legs) {
  console.log(`  ${label}  ${fmt(cost)}`);
  if (cost != null && cost > worst.cost) worst = { label: label.trim(), cost };
}
console.log(`  -----------------------------------  -----`);
console.log(`  TOTAL both-ready -> date-started     ${fmt(total)}`);
if (worst.label) {
  console.log(`\n  ⮕ dominant leg: "${worst.label}" (${worst.cost.toFixed(1)}s)`);
  if (worst.label.startsWith("entry_started -> date_started")) {
    console.log(
      `    Gated by both clients rendering the remote frame\n` +
      `    (mark_video_date_remote_seen -> stable_bilateral_media). Pull the\n` +
      `    client first_remote_frame / daily_prewarm_consumed / media_handoff_used\n` +
      `    PostHog checkpoints to split subscription vs. decode vs. play().`,
    );
  } else if (worst.label.startsWith("both joined -> entry_started")) {
    console.log(
      `    Both clients were in the Daily room this whole leg yet the server\n` +
      `    entry transition lagged. Compare to the first-surface-claim times\n` +
      `    below: if claims landed early, the lag is in claim_video_date_surface\n` +
      `    / video_date_transition re-attempts, not navigation.`,
    );
  } else if (worst.label.startsWith("both ready -> both joined")) {
    console.log(
      `    Daily join cost. Check the client daily_prewarm_consumed /\n` +
      `    daily_prewarm_join_success PostHog checkpoints — a prewarm miss makes\n` +
      `    each side pay a cold Daily bundle-load + join here.`,
    );
  }
}

console.log(`\n=== Daily webhook copresence (provider truth) ===`);
if (webhook.length === 0) console.log("  (none)");
for (const w of webhook) {
  console.log(
    `  ${w.occurred_at}  ${String(w.event_type).padEnd(20)} user=${String(w.provider_user_id ?? "—").slice(0, 8)}  webhook_lag=${w.webhook_lag_s ?? "—"}s`,
  );
}

const claims = await sql(`
  select actor_id, min(created_at) first_claim
  from video_date_surface_claim_events
  where session_id = '${sid}' and action = 'claim' and ok = true
  group by actor_id order by first_claim asc`);
console.log(`\n=== First successful /date surface claim per actor ===`);
if (claims.length === 0) console.log("  (none)");
for (const c of claims) {
  console.log(`  ${c.first_claim}  actor=${String(c.actor_id).slice(0, 8)}  (+${fmt(sec(c.first_claim, bothReady))} after both-ready)`);
}

async function posthogCheckpoints() {
  console.log(`\n=== Client checkpoint timeline (PostHog) ===`);
  if (!POSTHOG.key || !POSTHOG.projectId) {
    console.log(
      "  (not configured) set POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID,\n" +
      '  or store them once in the keychain (services "PostHog Personal API" /\n' +
      '  "PostHog Project ID"), to split the join→first-remote-frame window.',
    );
    return;
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(sid)) {
    console.log("  (skipped — session id is not a plain uuid)");
    return;
  }
  const hql =
    `SELECT timestamp, event, properties.checkpoint, properties.source_action, ` +
    `properties.duration_ms, properties.daily_prewarm_consumed, ` +
    `properties.media_handoff_used, properties.prewarmed_already_joined ` +
    `FROM events WHERE properties.session_id = '${sid}' ` +
    `AND timestamp > now() - INTERVAL 14 DAY ORDER BY timestamp ASC LIMIT 1000`;
  let res, body;
  try {
    res = await fetch(`${POSTHOG.host}/api/projects/${POSTHOG.projectId}/query/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${POSTHOG.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: hql } }),
    });
    body = await res.json();
  } catch (e) {
    console.log(`  (PostHog request failed: ${String(e).slice(0, 160)})`);
    return;
  }
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? " — key invalid, or missing Query:Read scope / project access (see detail)"
        : res.status === 404
          ? " — wrong POSTHOG_PROJECT_ID or host"
          : "";
    console.log(`  (PostHog ${res.status}${hint}) ${JSON.stringify(body).slice(0, 200)}`);
    return;
  }
  const rows = body.results ?? [];
  if (rows.length === 0) {
    console.log("  (no client events for this session_id in the last 14 days)");
    return;
  }
  const t0 = new Date(rows[0][0]).getTime();
  for (const [ts, event, checkpoint, srcAction, durMs, prewarm, handoff, prejoined] of rows) {
    const offset = ((new Date(ts).getTime() - t0) / 1000).toFixed(1).padStart(5);
    const tag = checkpoint || srcAction || "";
    const flags = [
      durMs != null ? `dur=${durMs}ms` : null,
      prewarm != null ? `prewarm=${prewarm}` : null,
      handoff != null ? `handoff=${handoff}` : null,
      prejoined != null ? `prejoined=${prejoined}` : null,
    ]
      .filter(Boolean)
      .join("  ");
    console.log(`  +${offset}s  ${String(event).padEnd(38)} ${String(tag).padEnd(28)} ${flags}`);
  }
}

await posthogCheckpoints();
console.log("");
