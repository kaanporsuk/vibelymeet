#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const requireLive = args.has("--require-live");
const skipLive = args.has("--skip-live");

function hasDbUrl() {
  return Boolean(
    process.env.SUPABASE_DB_URL ||
      process.env.PHASE8_STAGING_DB_URL ||
      process.env.DATABASE_URL,
  );
}

function run(name, command, options = {}) {
  console.log(`\n[video-date-golden-flow] ${name}: ${command}`);
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  return {
    name,
    command,
    required: options.required !== false,
    status: result.status ?? 1,
  };
}

const steps = [
  run("red-flag contracts", "npm run test:video-date:red-flags"),
  run("video-date v4 contracts", "npm run test:video-date-v4"),
  run(
    "edge function release surface",
    `npm run verify:video-date:functions -- ${
      requireLive ? "--require-remote" : "--skip-remote"
    }`,
  ),
];

if (!skipLive && (requireLive || hasDbUrl())) {
  steps.push(
    run(
      "operator invariants",
      "npm run check:video-date:invariants",
      { required: requireLive || hasDbUrl() },
    ),
  );
} else {
  steps.push({
    name: "operator invariants",
    command: "npm run check:video-date:invariants",
    required: false,
    status: 0,
    skipped: true,
    reason: skipLive ? "skipped_by_flag" : "missing_db_url",
  });
}

const failed = steps.find((step) => step.required && step.status !== 0);
const liveRuntimeEvidence = {
  two_user_golden_flow: "pending_operator_run",
  both_users_date_feedback: "pending_operator_run",
  expected_next_surface_after_feedback: "pending_operator_run",
  daily_provider_join_overlap: "pending_operator_run",
  native_physical_device_ios: "pending_operator_run",
  native_physical_device_android: "pending_operator_run",
};

console.log(
  JSON.stringify(
    {
      ok: !failed,
      certified: false,
      certification_blocker:
        "fresh_two_user_runtime_run_through_both_date_feedback_is_required",
      failed,
      automated_steps: steps,
      live_runtime_evidence: liveRuntimeEvidence,
    },
    null,
    2,
  ),
);

if (failed) process.exit(failed.status || 1);
