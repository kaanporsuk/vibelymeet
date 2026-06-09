#!/usr/bin/env tsx
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

type Mode = "all" | "two-user-web" | "rls" | "chaos" | "load" | "validation";

const CHAOS_SCENARIOS = [
  "duplicate_taps",
  "broadcast_loss",
  "daily_webhook_loss",
  "worker_crash_retry",
  "mobile_backgrounding",
  "reconnect_grace_expiry",
  "provider_room_cleanup_dry_run",
  "delayed_push_deeplink",
] as const;

const LOAD_PATHS = [
  "deadline_finalizer",
  "outbox_drainer",
  "snapshot_fetch",
  "daily_credentialed_entry",
] as const;

type JsonRecord = Record<string, unknown>;

function assertProbeOk(name: string, result: JsonRecord): void {
  if (result.ok === true && result.skipped !== true) return;
  const reason = typeof result.reason === "string" ? result.reason : "probe_failed";
  const status = result.status == null ? "" : ` status=${String(result.status)}`;
  throw new Error(`${name} did not pass:${status} reason=${reason}`);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
}

function probeSummary(result: JsonRecord): JsonRecord {
  const payload = result.payload && typeof result.payload === "object" && !Array.isArray(result.payload)
    ? result.payload as JsonRecord
    : {};
  return {
    ok: result.ok === true,
    dry_run: result.dry_run === true || payload.dry_run === true,
    status: typeof result.status === "number" ? result.status : null,
    latency_ms: typeof result.latency_ms === "number" ? result.latency_ms : null,
    reason: stringOrNull(result.reason) ?? stringOrNull(payload.error) ?? stringOrNull(payload.reason_code),
    outcome: stringOrNull(payload.outcome),
    preview_count: typeof payload.preview_count === "number" ? payload.preview_count : null,
  };
}

function parseOptions(argv: string[]) {
  const options: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    i += 1;
  }
  return options;
}

const options = parseOptions(process.argv.slice(2));
const mode = (typeof options.mode === "string" ? options.mode : "all") as Mode;
const dryRun = options["dry-run"] === true;

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  throw new Error(`Missing required env: ${names.join(" or ")}`);
}

function optionalEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function shouldRun(target: Mode): boolean {
  return mode === "all" || mode === target;
}

function commitSha() {
  return (optionalEnv("PHASE8_COMMIT_SHA", "GITHUB_SHA") ?? "").slice(0, 40);
}

function eventId() {
  return optionalEnv("PHASE8_E2E_EVENT_ID", "VIBELY_E2E_EVENT_ID", "PHASE8_EVENT_ID");
}

function functionsBaseUrl() {
  const url = optionalEnv("PHASE8_STAGING_SUPABASE_URL", "SUPABASE_URL");
  if (!url && dryRun) return "https://example.supabase.co/functions/v1";
  if (!url) return `${env("PHASE8_STAGING_SUPABASE_URL", "SUPABASE_URL").replace(/\/$/, "")}/functions/v1`;
  return `${url.replace(/\/$/, "")}/functions/v1`;
}

function materializeStorageState(label: "A" | "B"): string {
  const directPath = optionalEnv(`PHASE8_E2E_USER_${label}_STATE`, `VIBELY_E2E_USER_${label}_STATE`);
  if (directPath) return directPath;

  const json = env(`PHASE8_E2E_USER_${label}_STATE_JSON`);
  const dir = mkdtempSync(join(tmpdir(), `vibely-phase8-user-${label.toLowerCase()}-`));
  const file = join(dir, "storage-state.json");
  JSON.parse(json);
  writeFileSync(file, json, { encoding: "utf8", mode: 0o600 });
  return file;
}

function runCommand(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  const rendered = [command, ...args].join(" ");
  if (dryRun) {
    console.log(`[dry-run] ${rendered}`);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${rendered} exited with code ${code}`));
    });
  });
}

async function invokeCronFunction(name: string, body: JsonRecord = {}) {
  const startedAt = Date.now();
  if (dryRun) {
    console.log(`[dry-run] POST ${functionsBaseUrl()}/${name}`);
    return { ok: true, dry_run: true, status: 200, latency_ms: 0 };
  }

  const cronSecret = env("PHASE8_STAGING_CRON_SECRET", "CRON_SECRET");
  const response = await fetch(`${functionsBaseUrl()}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cronSecret}`,
      "x-cron-secret": cronSecret,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => "");
  let payload: JsonRecord = {};
  if (text.trim()) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as JsonRecord;
    } catch {
      payload = { parse_error: true };
    }
  }
  const payloadOk = payload.ok !== false;
  return {
    ok: response.ok && payloadOk,
    status: response.status,
    latency_ms: Date.now() - startedAt,
    reason: response.ok && payloadOk
      ? null
      : stringOrNull(payload.error) ?? stringOrNull(payload.reason_code) ?? "cron_probe_failed",
    payload,
  };
}

async function snapshotFetchProbe() {
  if (dryRun) {
    console.log(`[dry-run] POST ${functionsBaseUrl()}/video-date-snapshot`);
    return { ok: true, dry_run: true, latency_ms: 0 };
  }
  const sessionId = optionalEnv("PHASE8_SNAPSHOT_SESSION_ID", "VIDEO_DATE_RLS_SESSION_ID");
  const jwt = optionalEnv("PHASE8_PARTICIPANT_JWT", "VIDEO_DATE_RLS_PARTICIPANT_JWT");
  if (!sessionId || !jwt) throw new Error("snapshot_probe_env_missing");
  const startedAt = Date.now();
  const response = await fetch(`${functionsBaseUrl()}/video-date-snapshot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      apikey: env("PHASE8_STAGING_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"),
    },
    body: JSON.stringify({ session_id: sessionId, include_token: false }),
  });
  const text = await response.text().catch(() => "");
  let payload: JsonRecord = {};
  if (text.trim()) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as JsonRecord;
    } catch {
      payload = { parse_error: true };
    }
  }
  const payloadOk = payload.ok !== false;
  return {
    ok: response.ok && payloadOk,
    status: response.status,
    latency_ms: Date.now() - startedAt,
    reason: response.ok && payloadOk
      ? null
      : stringOrNull(payload.error) ?? stringOrNull(payload.reason_code) ?? "snapshot_probe_failed",
  };
}

type LiveCertificationKind = "two_user_e2e" | "rls_negative" | "chaos" | "load";
type LiveCertificationStatus = "passed" | "failed" | "blocked";

async function recordStatus(
  kind: LiveCertificationKind,
  platform: string,
  status: LiveCertificationStatus,
  report: JsonRecord,
) {
  const sha = commitSha();
  const targetEventId = eventId();
  await runCommand("npx", [
    "tsx",
    "scripts/phase8-certification.ts",
    "record",
    "--run-kind",
    kind,
    "--platform",
    platform,
    "--status",
    status,
    ...(sha ? ["--commit-sha", sha] : []),
    "--report-json",
    JSON.stringify({ recorded_via: "scripts/phase8-live-certification.ts", ...report }),
    ...(targetEventId ? ["--event-id", targetEventId] : []),
  ]);
}

async function record(kind: LiveCertificationKind, platform: string, report: JsonRecord) {
  await recordStatus(kind, platform, "passed", report);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

function statusForFailure(error: unknown): LiveCertificationStatus {
  const message = errorMessage(error);
  if (
    /Missing required env|snapshot_probe_env_missing|storage-state|PHASE8_|VIBELY_E2E_|VIDEO_DATE_RLS_|SUPABASE_|DATABASE_URL/i
      .test(message)
  ) {
    return "blocked";
  }
  return "failed";
}

async function recordFailure(
  kind: LiveCertificationKind,
  platform: string,
  phase: string,
  error: unknown,
) {
  try {
    await recordStatus(kind, platform, statusForFailure(error), {
      phase,
      error: errorMessage(error),
    });
  } catch (recordError) {
    console.error(`Failed to record ${kind} failure: ${errorMessage(recordError)}`);
  }
}

async function runCertification(
  kind: LiveCertificationKind,
  platform: string,
  phase: string,
  runner: () => Promise<void>,
) {
  try {
    await runner();
  } catch (error) {
    await recordFailure(kind, platform, phase, error);
    throw error;
  }
}

async function runTwoUserWeb() {
  const userAState = dryRun ? "./.auth/phase8-user-a.json" : materializeStorageState("A");
  const userBState = dryRun ? "./.auth/phase8-user-b.json" : materializeStorageState("B");
  const targetEventId = dryRun ? "00000000-0000-4000-8000-000000000000" : env("PHASE8_E2E_EVENT_ID", "VIBELY_E2E_EVENT_ID");
  await runCommand("npx", [
    "playwright",
    "test",
    "-c",
    "e2e/playwright.config.ts",
    "e2e/video-date-two-user.staging.spec.ts",
    "--project=chromium",
  ], {
    VIBELY_E2E_USE_EXTERNAL_SERVER: "1",
    VIBELY_E2E_TWO_USER_WEB: "1",
    VIBELY_E2E_USER_A_STATE: userAState,
    VIBELY_E2E_USER_B_STATE: userBState,
    VIBELY_E2E_EVENT_ID: targetEventId,
    PLAYWRIGHT_BASE_URL: dryRun ? "https://staging.example.com" : env("PHASE8_STAGING_BASE_URL", "PLAYWRIGHT_BASE_URL"),
  });
  await record("two_user_e2e", "web", {
    harness: "e2e/video-date-two-user.staging.spec.ts",
    scenarios: ["ready_gate", "early_continue", "reload_recovery", "survey_recovery"],
  });
}

async function runRuntimeRls() {
  await runCommand("npx", ["tsx", "shared/matching/videoDateRealtimeRlsRuntime.test.ts"], {
    VIDEO_DATE_RLS_SUPABASE_URL: dryRun
      ? "https://example.supabase.co"
      : env("PHASE8_STAGING_SUPABASE_URL", "VIDEO_DATE_RLS_SUPABASE_URL", "SUPABASE_URL"),
    VIDEO_DATE_RLS_SUPABASE_ANON_KEY: dryRun
      ? "dry-run-anon-key"
      : env(
          "PHASE8_STAGING_SUPABASE_ANON_KEY",
          "VIDEO_DATE_RLS_SUPABASE_ANON_KEY",
          "SUPABASE_ANON_KEY",
          "VITE_SUPABASE_ANON_KEY",
        ),
    VIDEO_DATE_RLS_SESSION_ID: dryRun
      ? "00000000-0000-4000-8000-000000000001"
      : env("PHASE8_RLS_SESSION_ID", "VIDEO_DATE_RLS_SESSION_ID"),
    VIDEO_DATE_RLS_PARTICIPANT_JWT: dryRun
      ? "dry-run-participant-jwt"
      : env("PHASE8_RLS_PARTICIPANT_JWT", "VIDEO_DATE_RLS_PARTICIPANT_JWT"),
    VIDEO_DATE_RLS_NON_PARTICIPANT_JWT: dryRun
      ? "dry-run-non-participant-jwt"
      : env("PHASE8_RLS_NON_PARTICIPANT_JWT", "VIDEO_DATE_RLS_NON_PARTICIPANT_JWT"),
  });
  await record("rls_negative", "backend", {
    harness: "shared/matching/videoDateRealtimeRlsRuntime.test.ts",
    scenarios: ["participant_subscribe_allowed", "non_participant_subscribe_denied"],
  });
}

async function runChaos() {
  await runCommand("npx", ["tsx", "shared/matching/videoDatePhase3SafetyQueueContracts.test.ts"]);
  await runCommand("npx", ["tsx", "shared/matching/videoDatePhase4BroadcastContracts.test.ts"]);
  await runCommand("npx", ["tsx", "shared/matching/videoDatePhase5TimelineContracts.test.ts"]);
  const synthetic = await invokeCronFunction("synthetic-video-date-monitor", {
    mode: "status",
    event_id: eventId(),
  });
  const outboxDryRun = await invokeCronFunction("video-date-outbox-drainer", {
    dry_run: true,
    batch_size: 25,
    source: "phase8_chaos_worker_crash_retry_probe",
  });
  const deadlineDryRun = await invokeCronFunction("video-date-deadline-finalizer", {
    dry_run: true,
    batch_size: 25,
    source: "phase8_chaos_worker_crash_retry_probe",
  });
  assertProbeOk("synthetic-video-date-monitor", synthetic);
  assertProbeOk("video-date-outbox-drainer chaos dry-run", outboxDryRun);
  assertProbeOk("video-date-deadline-finalizer chaos dry-run", deadlineDryRun);

  await record("chaos", "cross_platform", {
    scenarios: Object.fromEntries(CHAOS_SCENARIOS.map((scenario) => [scenario, "automated_probe_or_contract_passed"])),
    synthetic_monitor: probeSummary(synthetic),
    outbox_drainer_dry_run: probeSummary(outboxDryRun),
    deadline_finalizer_dry_run: probeSummary(deadlineDryRun),
  });
}

async function runLoad() {
  const outbox = await invokeCronFunction("video-date-outbox-drainer", {
    dry_run: true,
    batch_size: 100,
    source: "phase8_load_probe",
  });
  const deadline = await invokeCronFunction("video-date-deadline-finalizer", {
    dry_run: true,
    batch_size: 100,
    source: "phase8_load_probe",
  });
  const snapshot = await snapshotFetchProbe();
  assertProbeOk("video-date-outbox-drainer load dry-run", outbox);
  assertProbeOk("video-date-deadline-finalizer load dry-run", deadline);
  assertProbeOk("video-date-snapshot load probe", snapshot);

  await runCommand("npx", ["tsx", "shared/matching/videoDatePhase7DailyPerformanceContracts.test.ts"]);
  await record("load", "backend", {
    paths: [...LOAD_PATHS],
    path_results: {
      deadline_finalizer: "dry_run_verified",
      outbox_drainer: "dry_run_verified",
      snapshot_fetch: "runtime_probe_when_configured",
      daily_credentialed_entry_path: "phase7_contract_verified",
    },
    outbox_drainer: probeSummary(outbox),
    deadline_finalizer: probeSummary(deadline),
    snapshot_fetch: probeSummary(snapshot),
  });
}

async function runValidation() {
  const dbUrl = dryRun ? "postgresql://phase8-dry-run.invalid/postgres" : env("PHASE8_STAGING_DB_URL", "SUPABASE_DB_URL", "DATABASE_URL");
  const targetEventId = eventId();
  const pgOptions = targetEventId
    ? `${process.env.PGOPTIONS ? `${process.env.PGOPTIONS} ` : ""}-c app.video_date_phase8_event_id=${targetEventId}`
    : process.env.PGOPTIONS;
  await runCommand("psql", [
    dbUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "supabase/validation/video_date_phase8_certification_rollout.sql",
  ], pgOptions ? { PGOPTIONS: pgOptions } : {});
}

async function main() {
  if (!["all", "two-user-web", "rls", "chaos", "load", "validation"].includes(mode)) {
    throw new Error(`Invalid --mode ${mode}`);
  }
  if (shouldRun("two-user-web")) {
    await runCertification("two_user_e2e", "web", "two-user-web", runTwoUserWeb);
  }
  if (shouldRun("rls")) {
    await runCertification("rls_negative", "backend", "rls", runRuntimeRls);
  }
  if (shouldRun("chaos")) {
    await runCertification("chaos", "cross_platform", "chaos", runChaos);
  }
  if (shouldRun("load")) {
    await runCertification("load", "backend", "load", runLoad);
  }
  if (shouldRun("validation")) await runValidation();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
