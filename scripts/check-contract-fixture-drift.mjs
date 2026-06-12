#!/usr/bin/env node
/**
 * Contract-fixture freshness check (2026-06-12 acceptance follow-up round 2).
 *
 * The truth-pin suites assert against pg_get_functiondef() dumps committed
 * under supabase/contract-fixtures/2026-06/functions/public-heads/. Those pins
 * are only as good as the dumps: on 2026-06-12 the video_date_transition
 * fixture turned out to have silently drifted from live since the PR-5 vocab
 * flip, and the pins were green against stale truth. This script dumps each
 * pinned public head from the LIVE linked project and diffs it against the
 * committed fixture.
 *
 * Read-only; uses the keychain management-API SQL channel (never prints the
 * token). Reports drift per function and exits 1 if any drift is found, so it
 * can run as a periodic operator check: npm run check:contract-fixture-drift
 * (Deliberately NOT part of the static battery — it needs live access.)
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(repoRoot, "supabase/contract-fixtures/2026-06/functions/public-heads");
const PROJECT_REF = "schdyxcunwcvddlcshwd";

const token = execFileSync("bash", ["-c",
  `security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d`,
]).toString().trim();

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sql failed: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const md5 = (s) => crypto.createHash("md5").update(s.trim()).digest("hex");

// Fixtures kept deliberately as dropped-chain history (absence asserted by the
// truth-pin suites); the live function is EXPECTED to be gone.
const DROPPED_HISTORY = new Set([
  "finalize_video_date_handshake_deadline", // PR-5 vocab flip → finalize_video_date_entry_deadline
  "video_session_date_timeout_v2", // PR-8 frozen v2 family drop (20260612134101)
  "video_session_forfeit_v2", // PR-8 frozen v2 family drop
  "video_session_handshake_auto_promote_v2", // PR-8 frozen v2 family drop
]);

const fixtures = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".sql"));
let drifted = 0;
let missing = 0;
for (const file of fixtures) {
  const fnName = file.replace(/\.sql$/, "");
  const committed = fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8");
  const rows = await sql(
    `select pg_get_functiondef(p.oid) def from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '${fnName}'`,
  );
  if (rows.length === 0) {
    if (DROPPED_HISTORY.has(fnName)) {
      console.log(`history  ${fnName} — intentionally dropped; fixture kept as history`);
      continue;
    }
    console.log(`MISSING  ${fnName} — fixture exists but live function is gone`);
    missing += 1;
    continue;
  }
  if (DROPPED_HISTORY.has(fnName)) {
    console.log(`REVIVED? ${fnName} — listed as dropped history but a live function exists`);
    drifted += 1;
    continue;
  }
  if (rows.length > 1) {
    console.log(`OVERLOAD ${fnName} — ${rows.length} live overloads; comparing skipped (inspect manually)`);
    continue;
  }
  if (md5(rows[0].def) === md5(committed)) {
    console.log(`ok       ${fnName}`);
  } else {
    console.log(`DRIFT    ${fnName} — live body differs from committed fixture (re-dump + attribute every hunk before re-pointing pins)`);
    drifted += 1;
  }
}
console.log(`\n${fixtures.length} fixtures checked: ${drifted} drifted, ${missing} missing`);
process.exit(drifted + missing > 0 ? 1 : 0);
