import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260508114500_event_lifecycle_archived_status_guards.sql");
const adminEvents = read("src/components/admin/AdminEventsPanel.tsx");
const adminEventControls = read("src/components/admin/AdminEventControls.tsx");
const adminActivityLog = read("src/components/admin/AdminActivityLog.tsx");
const adminLiveEventMetrics = read("src/components/admin/AdminLiveEventMetrics.tsx");
const overviewHook = read("src/hooks/useAdminOverviewDashboard.ts");
const checkout = read("supabase/functions/create-event-checkout/index.ts");
const lobbyGate = read("src/lib/eventLobbyGating.ts");

function fnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = migration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = migration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = migration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const candidates = [next, revoke].filter((index) => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : migration.length;
  return migration.slice(start, end);
}

test("finalize_due_events is idempotent, lock-safe, audited, and cron scheduled", () => {
  const source = fnSection("finalize_due_events");

  assert.match(source, /p_limit integer DEFAULT 100/);
  assert.match(source, /p_now timestamptz DEFAULT now\(\)/);
  assert.match(source, /e\.archived_at IS NULL/);
  assert.match(source, /e\.ended_at IS NULL/);
  assert.match(source, /lower\(COALESCE\(e\.status, 'upcoming'\)\) NOT IN \('draft', 'cancelled', 'archived'\)/);
  assert.match(source, /interval '10 minutes' <= v_now/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /ended_at = candidates\.scheduled_end/);
  assert.match(source, /status = 'ended'/);
  assert.match(source, /'event\.auto_finalize'/);
  assert.match(source, /'actor_type', 'system'/);
  assert.match(source, /'auto_finalize_at', updated\.scheduled_end \+ interval '10 minutes'/);
  assert.match(source, /'grace_minutes', 10/);

  assert.match(migration, /ALTER COLUMN admin_id DROP NOT NULL/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.finalize_due_events\(integer, timestamptz\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.finalize_due_events\(integer, timestamptz\) TO service_role/);
  assert.match(migration, /IF EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'\)/);
  assert.match(migration, /cron\.unschedule\(v_job_id\)/);
  assert.match(migration, /cron\.schedule\(\s*'event-lifecycle-auto-finalize',\s*'\* \* \* \* \*'/);
});

test("admin mutations enforce the scheduled-end and terminal-ended-at contract", () => {
  const endEvent = fnSection("admin_end_event");
  const extendEvent = fnSection("admin_extend_event");
  const goLive = fnSection("admin_go_live_event");
  const cancel = fnSection("admin_cancel_event");
  const reminder = fnSection("admin_send_event_reminder");
  const updateEvent = fnSection("admin_update_event");

  assert.match(endEvent, /v_before\.ended_at IS NOT NULL/);
  assert.match(endEvent, /lower\(COALESCE\(v_before\.status, ''\)\) IN \('draft', 'cancelled', 'archived'\)/);
  assert.doesNotMatch(endEvent, /'completed', 'cancelled'/);
  assert.match(endEvent, /WHEN v_scheduled_end IS NOT NULL AND v_now >= v_scheduled_end THEN v_scheduled_end/);
  assert.match(endEvent, /ELSE v_now/);

  assert.match(extendEvent, /v_before\.ended_at IS NOT NULL/);
  assert.match(extendEvent, /lower\(COALESCE\(v_before\.status, ''\)\) IN \('draft', 'completed', 'cancelled', 'archived'\)/);
  assert.match(extendEvent, /v_now >= v_scheduled_end \+ interval '10 minutes'/);
  assert.match(extendEvent, /v_extended_end <= v_now/);
  assert.match(extendEvent, /Extension must move the scheduled event end into the future/);
  assert.match(extendEvent, /scheduled_end_before/);
  assert.match(extendEvent, /scheduled_end_after/);

  assert.match(goLive, /v_before\.ended_at IS NOT NULL/);
  assert.match(goLive, /lower\(COALESCE\(v_before\.status, ''\)\) IN \('draft', 'cancelled', 'completed', 'archived'\)/);
  assert.doesNotMatch(goLive, /'cancelled', 'ended', 'completed'/);
  assert.match(goLive, /v_now < v_before\.event_date OR v_now >= v_scheduled_end/);

  assert.match(cancel, /v_before\.ended_at IS NOT NULL/);
  assert.match(cancel, /lower\(COALESCE\(v_before\.status, ''\)\) IN \('cancelled', 'completed', 'archived'\)/);
  assert.match(cancel, /Events cannot be cancelled after their scheduled end/);
  assert.match(cancel, /now\(\) >= v_scheduled_end/);

  assert.match(reminder, /v_event\.ended_at IS NOT NULL/);
  assert.match(reminder, /now\(\) >= v_scheduled_end/);
  assert.match(reminder, /Reminders cannot be sent after the scheduled event end/);

  assert.match(updateEvent, /v_before\.ended_at IS NOT NULL/);
  assert.match(updateEvent, /lower\(COALESCE\(v_before\.status, ''\)\) IN \('ended', 'completed'\)/);
  assert.match(updateEvent, /now\(\) >= v_before\.event_date \+ COALESCE\(v_before\.duration_minutes, 60\) \* interval '1 minute'/);
  assert.match(updateEvent, /WHERE key NOT IN \('title', 'description', 'cover_image', 'language', 'tags', 'vibes'\)/);
  assert.match(updateEvent, /Closed events only allow content corrections/);
});

test("registration, paid checkout settlement, checkout creation, and lobby gates close at scheduled end", () => {
  const register = fnSection("register_for_event");
  const settle = fnSection("settle_event_ticket_checkout");

  assert.match(register, /v_ended_at IS NOT NULL/);
  assert.match(register, /now\(\) >= v_event_date \+ COALESCE\(v_duration_minutes, 60\) \* interval '1 minute'/);
  assert.match(register, /lower\(COALESCE\(v_status, ''\)\) IN \('draft', 'cancelled', 'archived'\)/);

  assert.match(settle, /v_ended_at IS NOT NULL/);
  assert.match(settle, /now\(\) >= v_event_date \+ COALESCE\(v_duration_minutes, 60\) \* interval '1 minute'/);
  assert.match(settle, /'code', 'EVENT_CLOSED'/);

  assert.match(checkout, /function eventIsClosedBySchedule/);
  assert.match(checkout, /typeof eventDate !== 'string' \|\| !eventDate\) return true/);
  assert.match(checkout, /!Number\.isFinite\(startsAt\)\) return true/);
  assert.match(checkout, /Date\.now\(\) >= startsAt \+ duration \* 60_000/);
  assert.match(checkout, /status === 'draft' \|\| status === 'cancelled' \|\| status === 'archived'/);
  assert.doesNotMatch(checkout, /status === 'ended'/);

  assert.match(lobbyGate, /resolveEventLifecycle/);
  assert.match(lobbyGate, /if \(lifecycle\.isEnded\)/);
  assert.match(lobbyGate, /canFetchDeck: false/);
});

test("admin Events UI shows grace controls, hides normal finalization, and keeps repair in overflow", () => {
  assert.match(adminEventControls, /showWrapUpGrace/);
  assert.match(adminEventControls, /Wrap-up\{autoFinalizeLabel/);
  assert.match(adminEventControls, /\+15 min/);
  assert.match(adminEventControls, /End now/);
  assert.doesNotMatch(adminEventControls, /Finalize End/);
  assert.doesNotMatch(adminEventControls, /kind: "finalize-end"/);

  assert.match(adminEvents, /wrap_up_grace/);
  assert.match(adminEvents, /needs_finalization_repair/);
  assert.match(adminEvents, /Auto-finalizes/);
  assert.match(adminEvents, /Missing ended_at/);
  assert.match(adminEvents, /kind: "finalize-repair"/);
  assert.match(adminEvents, /Finalize now/);
  assert.match(adminEvents, /Finalization repair from \/kaan dashboard/);
});

test("overview, activity, and analytics surfaces understand auto-finalization states", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_get_overview_dashboard/);
  assert.match(migration, /'wrap_up_grace'/);
  assert.match(migration, /'needs_finalization_repair'/);
  assert.match(migration, /'lifecycle_status'/);
  assert.match(migration, /'is_in_finalization_grace'/);
  assert.match(migration, /'needs_finalization_repair'/);

  assert.match(overviewHook, /wrap_up_grace/);
  assert.match(overviewHook, /needs_finalization_repair/);
  assert.match(overviewHook, /auto_finalize_at/);
  assert.match(adminActivityLog, /"event\.auto_finalize"/);
  assert.match(adminActivityLog, /actorLabel = log\.details\?\.actor_type === "system"/);
  assert.match(adminLiveEventMetrics, /resolveEventLifecycle/);
  assert.match(adminLiveEventMetrics, /wrap-up grace/);
  assert.match(adminLiveEventMetrics, /needs repair/);
});
