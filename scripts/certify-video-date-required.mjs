#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const steps = [
  ["typecheck", "npm run typecheck"],
  ["video-date-v4", "npm run test:video-date-v4"],
  ["event-lobby-regression", "npm run test:event-lobby-regression"],
  ["daily-room-contract", "npm run test:daily-room-contract"],
  ["runtime-rls-required", "npm run test:video-date-runtime-rls:required"],
  ["phase8-config-readiness", "npm run phase8:config-readiness"],
  ["phase8-live-certification", "npm run phase8:live-certify"],
];

const manualEvidence = {
  web_two_user: "pending_user_owned",
  ios_two_user: "pending_user_owned",
  android_two_user: "pending_user_owned",
  screenshot_review: "pending_user_owned",
  provider_dashboard_daily_webhook: "pending_user_owned",
  provider_dashboard_daily_quota: "pending_user_owned",
  cron_worker_schedule_health: "pending_user_owned",
  recovery_alert_delivery: "pending_user_owned",
};

let failed = null;

for (const [name, command] of steps) {
  console.log(`\n[video-date-certification] ${name}: ${command}`);
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    failed = { name, command, status: result.status ?? 1 };
    break;
  }
}

console.log(JSON.stringify({
  ok: failed === null,
  failed,
  automated_steps: steps.map(([name, command]) => ({ name, command })),
  manual_evidence: manualEvidence,
}, null, 2));

if (failed) process.exit(failed.status);
