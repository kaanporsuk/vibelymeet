#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const skipRemote = args.has("--skip-remote");
const requireRemote = args.has("--require-remote");
const jsonOutput = args.has("--json");
const projectRef =
  process.env.SUPABASE_PROJECT_REF ||
  process.env.PHASE8_STAGING_SUPABASE_PROJECT_REF ||
  "schdyxcunwcvddlcshwd";

const requiredFunctions = [
  "daily-room",
  "video-date-daily-webhook",
  "video-date-snapshot",
  "video-date-token-refresh",
  "video-date-room-cleanup",
  "video-date-orphan-room-cleanup",
  "video-date-outbox-drainer",
  "video-date-deadline-finalizer",
  "video-date-recovery-alert-dispatcher",
  "post-date-verdict",
  "post-date-verdict-reminders",
  "admin-video-date-ops",
  "synthetic-video-date-monitor",
];

const requiredConfigMarkers = requiredFunctions.map(
  (name) => `[functions.${name}]`,
);

const results = [];

function add(status, label, detail) {
  results.push({ status, label, detail });
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function run(command, commandArgs, label) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_TELEMETRY_DISABLED: "1",
      SUPABASE_CLI_TELEMETRY_OPTOUT: "1",
    },
    timeout: 120_000,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error) {
    add(requireRemote ? "fail" : "warn", label, result.error.message);
    return null;
  }
  if (result.status !== 0) {
    add(
      requireRemote ? "fail" : "warn",
      label,
      (stderr || stdout || `exit ${result.status}`).slice(0, 1200),
    );
    return null;
  }
  add("pass", label, "command completed");
  return stdout || stderr;
}

function splitRemoteFunctionRow(line) {
  if (line.includes("|")) {
    return line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
  }
  if (line.includes("│")) {
    return line
      .split("│")
      .map((cell) => cell.trim())
      .filter(Boolean);
  }
  return line.trim().split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
}

function parseRemoteFunctionSlugs(output) {
  const slugs = new Set();
  let slugColumnIndex = -1;

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^[-+─│|\s]+$/.test(trimmed)) continue;

    const cells = splitRemoteFunctionRow(trimmed);
    if (cells.length === 0) continue;

    const lowerCells = cells.map((cell) => cell.toLowerCase());
    const headerSlugIndex = lowerCells.findIndex((cell) =>
      cell === "slug" || cell === "name" || cell === "function",
    );
    if (headerSlugIndex >= 0) {
      slugColumnIndex = headerSlugIndex;
      continue;
    }

    if (slugColumnIndex >= 0 && cells[slugColumnIndex]) {
      slugs.add(cells[slugColumnIndex]);
      continue;
    }

    for (const cell of cells) {
      if (requiredFunctions.includes(cell)) slugs.add(cell);
    }
  }

  return slugs;
}

function localChecks() {
  const configPath = "supabase/config.toml";
  const config = existsSync(join(root, configPath)) ? read(configPath) : "";
  if (!config) {
    add("fail", "Supabase config", `${configPath} is missing`);
  } else {
    for (const marker of requiredConfigMarkers) {
      add(
        config.includes(marker) ? "pass" : "fail",
        `Supabase config ${marker}`,
        config.includes(marker) ? "found" : "missing",
      );
    }
  }

  for (const name of requiredFunctions) {
    const path = join(root, "supabase/functions", name, "index.ts");
    add(
      existsSync(path) ? "pass" : "fail",
      `Function source ${name}`,
      existsSync(path) ? `supabase/functions/${name}/index.ts` : "missing index.ts",
    );
  }
}

function remoteChecks() {
  if (skipRemote) {
    add("warn", "Remote function verification", "skipped by --skip-remote");
    return;
  }

  const version = run("supabase", ["--version"], "Supabase CLI version");
  if (version) {
    add("pass", "Supabase CLI version output", version.trim().slice(0, 120));
  }

  const remote = run(
    "supabase",
    ["functions", "list", "--project-ref", projectRef],
    `Remote functions list ${projectRef}`,
  );
  if (!remote) return;
  const remoteSlugs = parseRemoteFunctionSlugs(remote);

  for (const name of requiredFunctions) {
    const found = remoteSlugs.has(name);
    add(
      found ? "pass" : requireRemote ? "fail" : "warn",
      `Remote function ${name}`,
      found ? "listed" : "not found in remote functions list",
    );
  }
}

localChecks();
remoteChecks();

const counts = results.reduce((acc, result) => {
  acc[result.status] = (acc[result.status] ?? 0) + 1;
  return acc;
}, {});
const ok = (counts.fail ?? 0) === 0;

if (jsonOutput) {
  console.log(JSON.stringify({ ok, project_ref: projectRef, counts, results }, null, 2));
} else {
  for (const result of results) {
    const prefix = result.status.toUpperCase().padEnd(4);
    console.log(`${prefix} ${result.label} - ${result.detail}`);
  }
  console.log(`\nSummary: ${counts.pass ?? 0} pass, ${counts.warn ?? 0} warn, ${counts.fail ?? 0} fail`);
}

process.exit(ok ? 0 : 1);
