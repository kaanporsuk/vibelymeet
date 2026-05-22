#!/usr/bin/env tsx
import { createClient } from "@supabase/supabase-js";

type CertificationRunKind =
  | "two_user_e2e"
  | "rls_negative"
  | "chaos"
  | "load"
  | "native_smoke"
  | "rollout_step"
  | "legacy_cleanup";

type CertificationPlatform = "web" | "native" | "mobile" | "cross_platform" | "backend" | "ops";
type CertificationStatus = "pending" | "passed" | "failed" | "blocked" | "waived";

const RUN_KINDS = new Set<CertificationRunKind>([
  "two_user_e2e",
  "rls_negative",
  "chaos",
  "load",
  "native_smoke",
  "rollout_step",
  "legacy_cleanup",
]);

const PLATFORMS = new Set<CertificationPlatform>([
  "web",
  "native",
  "mobile",
  "cross_platform",
  "backend",
  "ops",
]);

const STATUSES = new Set<CertificationStatus>(["pending", "passed", "failed", "blocked", "waived"]);
const ROLLOUT_STEPS = new Set([100, 1000, 5000, 10000]);

const NATIVE_SMOKE_FLAGS = [
  "ios",
  "android",
  "background-foreground",
  "delayed-push-deeplink",
  "switch-device",
  "early-continue",
  "safety",
  "mutual-extension",
  "survey-recovery",
] as const;

const SECRET_KEY_PATTERN =
  /(authorization|bearer|password|secret|api[_-]?key|daily[_-]?token|meeting[_-]?token|access[_-]?token|refresh[_-]?token)/i;

type ParsedArgs = {
  command: string;
  options: Record<string, string | true>;
};

function usage(): never {
  console.error(`Usage:
  npx tsx scripts/phase8-certification.ts record --run-kind two_user_e2e --platform web --status passed [--event-id uuid] [--commit-sha sha] [--report-json '{}']
  npx tsx scripts/phase8-certification.ts native-smoke --commit-sha sha --operator email --ios --android --background-foreground --delayed-push-deeplink --switch-device --early-continue --safety --mutual-extension --survey-recovery
  npx tsx scripts/phase8-certification.ts rollout-step --bps 100|1000|5000|10000 --commit-sha sha [--event-id uuid] [--report-json '{}']
  npx tsx scripts/phase8-certification.ts legacy-cleanup --commit-sha sha [--report-json '{}']

Environment:
  PHASE8_STAGING_SUPABASE_URL or SUPABASE_URL
  PHASE8_STAGING_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY`);
  process.exit(2);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (!command) usage();

  const options: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) usage();
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    i += 1;
  }

  return { command, options };
}

function option(options: Record<string, string | true>, key: string): string | null {
  const value = options[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function flag(options: Record<string, string | true>, key: string): boolean {
  return options[key] === true || options[key] === "true" || options[key] === "1";
}

function nullableUuid(value: string | null): string | null {
  if (!value || value.toLowerCase() === "null" || value.toLowerCase() === "global") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid UUID: ${value}`);
  }
  return value;
}

function normalizedSha(value: string | null): string | null {
  if (!value) return null;
  const sha = value.toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error(`Invalid commit SHA: ${value}`);
  return sha;
}

function requiredSha(value: string | null, command: string): string {
  if (!value) throw new Error(`${command} requires --commit-sha or GITHUB_SHA`);
  return value;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--report-json must be a JSON object");
  }
  assertNoSecretKeys(parsed);
  return parsed as Record<string, unknown>;
}

function assertNoSecretKeys(value: unknown, path = "report"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretKeys(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`Refusing to record secret-shaped report key at ${path}.${key}`);
    }
    assertNoSecretKeys(nested, `${path}.${key}`);
  }
}

function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  throw new Error(`Missing required env: ${names.join(" or ")}`);
}

function supabaseAdmin() {
  const url = requiredEnv("PHASE8_STAGING_SUPABASE_URL", "SUPABASE_URL");
  const serviceRoleKey = requiredEnv(
    "PHASE8_STAGING_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function recordCertification(input: {
  runKind: CertificationRunKind;
  platform: CertificationPlatform;
  status: CertificationStatus;
  eventId?: string | null;
  rolloutBps?: number | null;
  commitSha?: string | null;
  report?: Record<string, unknown>;
  notes?: string | null;
  expiresAt?: string | null;
}) {
  assertNoSecretKeys(input.report ?? {});
  const { data, error } = await supabaseAdmin().rpc("record_video_date_phase8_certification_run_v2", {
    p_run_kind: input.runKind,
    p_platform: input.platform,
    p_status: input.status,
    p_event_id: input.eventId ?? null,
    p_rollout_bps: input.rolloutBps ?? null,
    p_commit_sha: input.commitSha ?? null,
    p_report: input.report ?? {},
    p_notes: input.notes ?? null,
    p_expires_at: input.expiresAt ?? null,
  });
  if (error) throw new Error(`record certification RPC failed: ${error.message}`);
  const result = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (result.ok !== true) throw new Error(`record certification rejected: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
}

async function recordRolloutStep(input: {
  eventId?: string | null;
  rolloutBps: number;
  commitSha?: string | null;
  report?: Record<string, unknown>;
  notes?: string | null;
  expiresAt?: string | null;
}) {
  assertNoSecretKeys(input.report ?? {});
  const { data, error } = await supabaseAdmin().rpc("record_video_date_phase8_rollout_step_v2", {
    p_event_id: input.eventId ?? null,
    p_rollout_bps: input.rolloutBps,
    p_commit_sha: input.commitSha ?? null,
    p_report: input.report ?? {},
    p_notes: input.notes ?? null,
    p_expires_at: input.expiresAt ?? null,
  });
  if (error) throw new Error(`record rollout step RPC failed: ${error.message}`);
  const result = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (result.ok !== true) throw new Error(`record rollout step rejected: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
}

async function recordLegacyCleanup(input: {
  commitSha?: string | null;
  report?: Record<string, unknown>;
  notes?: string | null;
  expiresAt?: string | null;
}) {
  assertNoSecretKeys(input.report ?? {});
  const { data, error } = await supabaseAdmin().rpc("record_video_date_phase8_legacy_cleanup_v2", {
    p_commit_sha: input.commitSha ?? null,
    p_report: input.report ?? {},
    p_notes: input.notes ?? null,
    p_expires_at: input.expiresAt ?? null,
  });
  if (error) throw new Error(`record legacy cleanup RPC failed: ${error.message}`);
  const result = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  if (result.ok !== true) throw new Error(`record legacy cleanup rejected: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const commitSha = normalizedSha(option(options, "commit-sha") ?? process.env.GITHUB_SHA?.slice(0, 40) ?? null);
  const notes = option(options, "notes");
  const expiresAt = option(options, "expires-at");

  if (command === "record") {
    const runKind = option(options, "run-kind") as CertificationRunKind | null;
    const platform = option(options, "platform") as CertificationPlatform | null;
    const status = option(options, "status") as CertificationStatus | null;
    if (!runKind || !RUN_KINDS.has(runKind)) throw new Error("Invalid --run-kind");
    if (!platform || !PLATFORMS.has(platform)) throw new Error("Invalid --platform");
    if (!status || !STATUSES.has(status)) throw new Error("Invalid --status");
    if (status === "passed" && !commitSha) {
      throw new Error("passed certification records require --commit-sha or GITHUB_SHA");
    }
    if (
      status === "passed" &&
      (runKind === "native_smoke" || runKind === "rollout_step" || runKind === "legacy_cleanup")
    ) {
      throw new Error(`passed ${runKind} records must use the dedicated ${runKind.replaceAll("_", "-")} command`);
    }

    await recordCertification({
      runKind,
      platform,
      status,
      eventId: nullableUuid(option(options, "event-id")),
      rolloutBps: option(options, "rollout-bps") ? Number(option(options, "rollout-bps")) : null,
      commitSha,
      report: parseJsonObject(option(options, "report-json")),
      notes,
      expiresAt,
    });
    return;
  }

  if (command === "native-smoke") {
    const missing = NATIVE_SMOKE_FLAGS.filter((name) => !flag(options, name));
    if (missing.length > 0) {
      throw new Error(`native-smoke requires explicit evidence flags: ${missing.map((name) => `--${name}`).join(", ")}`);
    }
    const operator = option(options, "operator") ?? process.env.GITHUB_ACTOR ?? null;
    if (!operator || operator === "unknown") throw new Error("native-smoke requires --operator or GITHUB_ACTOR");
    await recordCertification({
      runKind: "native_smoke",
      platform: "native",
      status: "passed",
      eventId: nullableUuid(option(options, "event-id")),
      commitSha: requiredSha(commitSha, "native-smoke"),
      report: {
        recorded_via: "scripts/phase8-certification.ts",
        operator,
        evidence: Object.fromEntries(NATIVE_SMOKE_FLAGS.map((name) => [name.replaceAll("-", "_"), true])),
      },
      notes,
      expiresAt,
    });
    return;
  }

  if (command === "rollout-step") {
    const rolloutBps = Number(option(options, "bps") ?? option(options, "rollout-bps"));
    if (!ROLLOUT_STEPS.has(rolloutBps)) throw new Error("--bps must be one of 100, 1000, 5000, 10000");
    await recordRolloutStep({
      eventId: nullableUuid(option(options, "event-id")),
      rolloutBps,
      commitSha: requiredSha(commitSha, "rollout-step"),
      report: {
        recorded_via: "scripts/phase8-certification.ts",
        ...(parseJsonObject(option(options, "report-json"))),
      },
      notes,
      expiresAt,
    });
    return;
  }

  if (command === "legacy-cleanup") {
    await recordLegacyCleanup({
      commitSha: requiredSha(commitSha, "legacy-cleanup"),
      report: {
        recorded_via: "scripts/phase8-certification.ts",
        ...(parseJsonObject(option(options, "report-json"))),
      },
      notes,
      expiresAt,
    });
    return;
  }

  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
