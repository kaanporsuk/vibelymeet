#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const skipRemote = args.has("--skip-remote");
const requireRemote = args.has("--require-remote");
const jsonOutput = args.has("--json");

const results = [];

function add(status, label, detail) {
  results.push({ status, label, detail });
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function checkFile(path, label = path) {
  if (existsSync(join(root, path))) {
    add("pass", label, path);
    return true;
  }
  add("fail", label, `${path} is missing`);
  return false;
}

function checkSource(path, markers, label = path) {
  if (!checkFile(path, label)) return;
  const source = read(path);
  for (const marker of markers) {
    const found = marker instanceof RegExp ? marker.test(source) : source.includes(marker);
    add(found ? "pass" : "fail", `${label}: ${String(marker)}`, found ? "found" : "missing");
  }
}

function run(command, commandArgs, label) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    timeout: 120_000,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error) {
    add(requireRemote ? "fail" : "warn", label, result.error.message);
    return null;
  }
  if (result.status !== 0) {
    add(requireRemote ? "fail" : "warn", label, (stderr || stdout || `exit ${result.status}`).slice(0, 1000));
    return null;
  }
  add("pass", label, "command completed");
  return stdout || stderr;
}

function checkRemoteText(output, markers, label) {
  if (output == null) return;
  for (const marker of markers) {
    const found = output.includes(marker);
    add(found ? "pass" : (requireRemote ? "fail" : "warn"), `${label}: ${marker}`, found ? "found" : "not found in remote output");
  }
}

function runLocalChecks() {
  checkSource("supabase/config.toml", [
    "[functions.daily-room]",
    "[functions.video-date-outbox-drainer]",
    "[functions.video-date-deadline-finalizer]",
    "[functions.send-notification]",
    "[functions.push-webhook]",
    "[functions.admin-video-date-ops]",
  ], "Supabase function catalog");

  checkSource("supabase/functions/daily-room/index.ts", [
    "prepare_date_entry",
    "confirm_video_date_entry_prepared",
    "DAILY_PROVIDER_UNAVAILABLE",
  ], "daily-room Edge Function");

  checkSource("supabase/functions/video-date-outbox-drainer/index.ts", [
    "claim_video_date_provider_outbox_v2",
    "complete_video_date_provider_outbox_v2",
    "notification.send",
  ], "video-date-outbox-drainer");

  checkSource("supabase/functions/admin-video-date-ops/index.ts", [
    "notification_outbox_health",
    "video_date_provider_outbox",
    "notification_log",
    "push_notification_events",
  ], "admin video-date ops");

  checkSource("supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql", [
    "CREATE OR REPLACE FUNCTION public.ready_gate_transition",
    "GET DIAGNOSTICS v_row_count = ROW_COUNT",
  ], "Ready Gate transition migration");

  checkSource("supabase/migrations/20260524090000_video_date_phase1_provider_reliability.sql", [
    "video_date_provider_outbox_failure_log",
    "video_date_provider_dead_letters",
  ], "Provider reliability migration");

  checkSource("supabase/migrations/20260601184653_video_date_outbox_provider_idempotency.sql", [
    "claim_video_date_provider_outbox_v2",
    "provider_idempotency_key",
  ], "Provider idempotency migration");

  checkSource("src/hooks/useReadyGate.ts", [
    "ready_gate_transition",
    "video_date.outbox_v2.mark_ready",
    "video_date.timeline_v2",
  ], "web Ready Gate hook");

  checkSource("apps/mobile/lib/readyGateApi.ts", [
    "ready_gate_transition",
    "video_date.outbox_v2.mark_ready",
    "video_date.timeline_v2",
  ], "native Ready Gate hook");
}

function runRemoteChecks() {
  if (skipRemote) {
    add("warn", "Remote Supabase validation", "skipped by --skip-remote");
    return;
  }

  const migrations = run("supabase", ["migration", "list", "--linked"], "Remote migration list");
  checkRemoteText(migrations, [
    "20260501190000",
    "20260522011000",
    "20260524090000",
    "20260524203000",
    "20260525235500",
    "20260601184653",
  ], "Remote migration history");

  const dryRun = run("supabase", ["db", "push", "--linked", "--dry-run"], "Remote migration dry-run");
  if (dryRun != null) {
    const hasPendingMigration = /supabase\/migrations|Would apply|Pending migrations/i.test(dryRun);
    add(
      hasPendingMigration ? (requireRemote ? "fail" : "warn") : "pass",
      "Remote migration dry-run has no pending repo migrations",
      hasPendingMigration ? dryRun.slice(0, 1000) : "no pending migrations detected",
    );
  }

  const functions = run("supabase", ["functions", "list"], "Remote functions list");
  checkRemoteText(functions, [
    "daily-room",
    "video-date-outbox-drainer",
    "send-notification",
    "push-webhook",
    "admin-video-date-ops",
  ], "Remote function catalog");
}

runLocalChecks();
runRemoteChecks();

const counts = results.reduce((acc, result) => {
  acc[result.status] = (acc[result.status] ?? 0) + 1;
  return acc;
}, {});

if (jsonOutput) {
  console.log(JSON.stringify({ ok: (counts.fail ?? 0) === 0, counts, results }, null, 2));
} else {
  for (const result of results) {
    const prefix = result.status.toUpperCase().padEnd(4);
    console.log(`${prefix} ${result.label} - ${result.detail}`);
  }
  console.log(`\nSummary: ${counts.pass ?? 0} pass, ${counts.warn ?? 0} warn, ${counts.fail ?? 0} fail`);
}

process.exit((counts.fail ?? 0) > 0 ? 1 : 0);
