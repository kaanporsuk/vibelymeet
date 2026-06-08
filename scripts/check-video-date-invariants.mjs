#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const sqlFile = join(repoRoot, "docs/sql/video-date-invariants.sql");
const envFile = join(repoRoot, ".env.cursor.local");

function loadLocalEnv() {
  if (!existsSync(envFile)) return;
  const text = readFileSync(envFile, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] != null) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function dbUrl() {
  return (
    process.env.SUPABASE_DB_URL ||
    process.env.PHASE8_STAGING_DB_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
}

function usage() {
  console.error(`Usage: npm run check:video-date:invariants [-- --warn-as-error]

Environment:
  Optional: SUPABASE_DB_URL, PHASE8_STAGING_DB_URL, or DATABASE_URL

The command runs docs/sql/video-date-invariants.sql through psql when a DB URL
is available. Otherwise it falls back to the linked Supabase project via:
  supabase db query --linked --file docs/sql/video-date-invariants.sql -o json

It exits nonzero for critical FAIL rows. Warnings remain visible but do not
fail the command unless --warn-as-error is passed.`);
}

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  usage();
  process.exit(0);
}

loadLocalEnv();

function runWithPsql(url) {
  const result = spawnSync(
    "psql",
    [
      url,
      "-v",
      "ON_ERROR_STOP=1",
      "--quiet",
      "--no-align",
      "--tuples-only",
      "--field-separator",
      "\t",
      "--pset",
      "footer=off",
      "-f",
      sqlFile,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PSQLRC: "/dev/null",
      },
    },
  );

  if (result.error) {
    console.error(`Failed to run psql: ${result.error.message}`);
    process.exit(2);
  }

  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.exit(result.status ?? 1);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [invariantId, severity, status, rowCount, sample, detail] =
        line.split("\t");
      return {
        invariantId,
        severity,
        status,
        rowCount: Number(rowCount),
        sample,
        detail,
      };
    });
}

function extractJson(text) {
  const starts = [];
  for (const char of ["{", "["]) {
    const index = text.indexOf(char);
    if (index >= 0) starts.push({ index, char });
  }
  starts.sort((a, b) => a.index - b.index);

  for (const { index: start, char } of starts) {
    const endChar = char === "{" ? "}" : "]";
    let end = text.length;
    while (end > start) {
      const candidateEnd = text.lastIndexOf(endChar, end - 1);
      if (candidateEnd === -1 || candidateEnd < start) break;
      try {
        return JSON.parse(text.slice(start, candidateEnd + 1));
      } catch {
        end = candidateEnd;
      }
    }
  }

  throw new Error("Supabase CLI did not return valid JSON");
}

function runWithSupabaseLinkedQuery() {
  const relativeSqlFile = "docs/sql/video-date-invariants.sql";
  const result = spawnSync(
    "supabase",
    ["db", "query", "--linked", "--file", relativeSqlFile, "-o", "json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_CLI_TELEMETRY_OPTOUT: "1",
      },
    },
  );

  if (result.error) {
    console.error(`Failed to run supabase db query: ${result.error.message}`);
    process.exit(2);
  }

  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.exit(result.status ?? 1);
  }

  let parsed;
  try {
    parsed = extractJson(result.stdout);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.stdout.write(result.stdout);
    process.exit(2);
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.rows)
      ? parsed.rows
      : [];

  return rows.map((row) => ({
    invariantId: String(row.invariant_id ?? ""),
    severity: String(row.severity ?? ""),
    status: String(row.status ?? ""),
    rowCount: Number(row.row_count ?? 0),
    sample: JSON.stringify(row.sample ?? []),
    detail: String(row.detail ?? ""),
  }));
}

const url = dbUrl();
const rows = url ? runWithPsql(url) : runWithSupabaseLinkedQuery();

console.log(
  url
    ? "Video Date invariant results"
    : "Video Date invariant results (linked Supabase project)",
);
console.log("invariant_id\tseverity\tstatus\trow_count\tdetail\tsample");
for (const row of rows) {
  console.log(
    [
      row.invariantId,
      row.severity,
      row.status,
      String(row.rowCount),
      row.detail,
      row.sample,
    ].join("\t"),
  );
}

const failRows = rows.filter((row) => row.status === "fail");
const warnRows = rows.filter((row) => row.status === "warn");
const warnAsError = args.has("--warn-as-error");

const summary = {
  ok: failRows.length === 0 && (!warnAsError || warnRows.length === 0),
  failures: failRows.map((row) => ({
    invariant_id: row.invariantId,
    severity: row.severity,
    row_count: row.rowCount,
  })),
  warnings: warnRows.map((row) => ({
    invariant_id: row.invariantId,
    severity: row.severity,
    row_count: row.rowCount,
  })),
};

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) process.exit(1);
