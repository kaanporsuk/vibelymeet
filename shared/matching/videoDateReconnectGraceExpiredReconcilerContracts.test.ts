import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260603150000_video_date_reconnect_grace_expired_date_reconciler.sql",
  ),
  "utf8",
);
const ownershipDoc = readFileSync(
  join(root, "docs/video-date-date-timeout-ownership-decision-log.md"),
  "utf8",
);

function boundedWrapperBody(): string {
  const match = migration.match(
    /CREATE OR REPLACE FUNCTION public\.expire_stale_video_date_phases_bounded[\s\S]+?COMMENT ON FUNCTION public\.expire_stale_video_date_phases_bounded/,
  );
  assert.ok(match, "missing expire_stale_video_date_phases_bounded wrapper block");
  return match[0];
}

test("F3 migration wraps the bounded reconciler additively (rename current to private base, call it first)", () => {
  // The current bounded reconciler is renamed to a private base, guarded so the
  // migration is idempotent and re-appliable.
  assert.match(
    migration,
    /ALTER FUNCTION public\.expire_stale_video_date_phases_bounded\(integer\)\s+RENAME TO expire_vd_phases_pre_grace_base_20260603/,
    "should rename the current bounded reconciler to a private base",
  );
  assert.match(
    migration,
    /to_regprocedure\('public\.expire_vd_phases_pre_grace_base_20260603\(integer\)'\) IS NULL/,
    "rename must be guarded for idempotency",
  );
  const body = boundedWrapperBody();
  assert.match(
    body,
    /v_base\s*:=\s*public\.expire_vd_phases_pre_grace_base_20260603\(v_limit\)/,
    "wrapper must call the renamed base first to preserve all prior behavior",
  );
});

test("F3 overlay ends only confirmed date sessions whose reconnect grace expired", () => {
  const body = boundedWrapperBody();
  assert.match(body, /state = 'date'::public\.video_date_state/, "must target the date phase");
  assert.match(body, /date_started_at IS NOT NULL/, "must require a started (confirmed-encounter) date");
  assert.match(body, /ended_at IS NULL/, "must only touch live sessions");
  assert.match(
    body,
    /reconnect_grace_ends_at IS NOT NULL\s*\n\s*AND reconnect_grace_ends_at <= v_now - interval '10 seconds'/,
    "must only end sessions whose reconnect grace expired, with a buffer beyond the 30s server grace",
  );
  assert.match(body, /FOR UPDATE SKIP LOCKED/, "must claim rows safely under concurrency");
});

test("F3 overlay produces a survey-eligible terminal state with the accurate reason", () => {
  const body = boundedWrapperBody();
  assert.match(
    body,
    /ended_reason = 'reconnect_grace_expired'/,
    "must use the accurate, survey-eligible reason (not date_timeout)",
  );
  // Mirror the date_timeout end-state so a confirmed date still earns the survey.
  assert.match(body, /queue_status = 'in_survey'/, "confirmed date must still open the Vibe/Pass survey");
  assert.match(body, /current_room_id = NULL/, "must release current_room_id so users can re-queue");
  assert.match(body, /current_partner_id = NULL/);
  // reconnect_grace_expired must NOT be a survey-exclusion reason in the encounter guard.
  const guard = readFileSync(
    join(root, "supabase/migrations/20260603090000_video_date_remote_seen_encounter_guard.sql"),
    "utf8",
  );
  assert.ok(
    !/NOT IN \([^)]*'reconnect_grace_expired'[^)]*\)/.test(guard),
    "reconnect_grace_expired must remain survey-eligible for confirmed encounters",
  );
});

test("F3 wrapper preserves the caller-visible return shape and exposes its own count", () => {
  const body = boundedWrapperBody();
  assert.match(
    body,
    /RETURN v_base \|\| jsonb_build_object\(\s*\n\s*'date_reconnect_grace_expired', v_rge,\s*\n\s*'total', v_base_total \+ v_rge/,
    "must merge onto the base result and re-total",
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.expire_stale_video_date_phases_bounded\(integer\)\s+TO service_role/,
    "wrapper must stay service_role-only",
  );
});

test("F5 decision: date_timeout stays legacy-cron-owned (no parallel v4 deadline)", () => {
  assert.match(ownershipDoc, /legacy-cron-owned/i);
  assert.match(ownershipDoc, /Do NOT add a\s*\n?\s*parallel v4 `date_timeout` deadline/i);
  // Guard the invariant the doc relies on: the v4 finalizer still rejects date_timeout.
  const engine = readFileSync(
    join(root, "supabase/migrations/20260521203000_video_date_phase2_transaction_engine.sql"),
    "utf8",
  );
  assert.match(engine, /unsupported_deadline_kind/, "v4 finalizer must still reject non-handshake kinds");
});
