import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { videoDateStartSnapshotToDateEntryTruth } from "./videoDateStartSnapshot";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const startSnapshotMigration = read("supabase/migrations/20260603150106_video_date_start_snapshot_ready_gate_hardening.sql");
const snapshotChunkingMigration = read("supabase/migrations/20260603161423_video_date_start_snapshot_jsonb_chunking.sql");
const migration = `${startSnapshotMigration}\n${snapshotChunkingMigration}`;
const webReadyGate = read("src/hooks/useReadyGate.ts");
const nativeReadyGate = read("apps/mobile/lib/readyGateApi.ts");
const webTruth = read("src/lib/videoDateSessionTruth.ts");
const nativeVideoDateApi = read("apps/mobile/lib/videoDateApi.ts");
const webOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const webReadyRedirect = read("src/pages/ReadyRedirect.tsx");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const webActiveSession = read("src/hooks/useActiveSession.ts");
const nativeActiveSession = read("apps/mobile/lib/useActiveSession.ts");

test("startup snapshot RPC is participant-safe, grant-backed, and PostgREST visible", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_start_snapshot_v1\(\s*p_session_id uuid\s*\)/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path TO 'public', 'pg_catalog'/);
  assert.match(migration, /v_uid = v_session\.participant_1_id[\s\S]*v_uid = v_session\.participant_2_id/);
  assert.match(migration, /public\.is_blocked\(v_session\.participant_1_id, v_session\.participant_2_id\)/);
  assert.match(migration, /'error', 'blocked_pair'[\s\S]*'terminal', true/);
  assert.match(migration, /'error', 'blocked_pair'[\s\S]*'ready_gate_status', 'ended'/);
  assert.match(migration, /'error', 'blocked_pair'[\s\S]*'can_mark_ready', false[\s\S]*'can_enter_date', false/);
  assert.match(migration, /'error', 'safety_check_unavailable'[\s\S]*'retryable', true/);
  assert.match(migration, /'error', 'safety_check_unavailable'[\s\S]*'ready_gate_status', v_ready_gate_status/);
  assert.match(migration, /'safety_check_unavailable'[\s\S]*'commandStatus', 'rejected'/);
  assert.match(migration, /'can_mark_ready'[\s\S]*'can_enter_date'[\s\S]*'server_now_ms'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_video_date_start_snapshot_v1\(uuid\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_video_date_start_snapshot_v1\(uuid\)[\s\S]*TO authenticated, service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.ready_gate_transition\(uuid, text, text\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.ready_gate_transition\(uuid, text, text\)[\s\S]*TO authenticated, service_role/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.ready_gate_transition\(uuid, text, text\)[\s\S]{0,120}TO anon/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.video_sessions TO authenticated/);
  assert.match(migration, /CREATE POLICY "Participants can view own sessions"[\s\S]*TO authenticated[\s\S]*NOT public\.is_blocked/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.has_role\(uuid, public\.app_role\) TO authenticated, service_role/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
});

test("Ready Gate public RPCs return structured payloads instead of uncaught startup 500s", () => {
  assert.match(migration, /ALTER FUNCTION public\.ready_gate_transition\(uuid, text, text\)[\s\S]*RENAME TO ready_gate_transition_20260603150106_start_snapshot_base/);
  assert.match(migration, /IF v_action = 'sync' THEN[\s\S]*public\.get_video_date_start_snapshot_v1\(p_session_id\)/);
  assert.match(migration, /'error', 'ready_gate_transition_failed'[\s\S]*'retryable', true/);

  assert.match(migration, /ALTER FUNCTION public\.video_session_mark_ready_v2\(uuid, text, text\)[\s\S]*RENAME TO video_session_mark_ready_v2_20260603150106_start_snapshot_base/);
  assert.match(migration, /v_before_snapshot := public\.get_video_date_start_snapshot_v1\(p_session_id\)/);
  assert.match(migration, /'error', 'mark_ready_failed'[\s\S]*'retry_after_ms', 2000/);
  assert.match(migration, /'startup_snapshot', v_after_snapshot/);

  assert.match(migration, /ALTER FUNCTION public\.record_video_date_launch_latency_checkpoint\(uuid, text, jsonb, integer\)[\s\S]*RENAME TO record_vd_launch_latency_20260603150106_start_base/);
  assert.match(migration, /'error', 'checkpoint_failed'[\s\S]*'retryable', false/);

  assert.match(migration, /ALTER FUNCTION public\.get_profile_for_viewer\(uuid\)[\s\S]*RENAME TO get_profile_for_viewer_20260603150106_start_base/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_profile_for_viewer\(p_target_id uuid\)[\s\S]*WHEN OTHERS THEN\s*RETURN NULL/s);
});

test("latest startup snapshot payload stays below Postgres JSON argument limits", () => {
  assert.match(snapshotChunkingMigration, /RETURN\s+jsonb_build_object\(/);
  assert.match(snapshotChunkingMigration, /\|\|\s*jsonb_build_object\(/);
  assert.match(snapshotChunkingMigration, /'viewer_role', v_actor_role/);
  assert.match(snapshotChunkingMigration, /NOTIFY pgrst, 'reload schema'/);

  for (const call of extractJsonbBuildObjectCalls(snapshotChunkingMigration)) {
    const argCount = countTopLevelArgs(call);
    assert.ok(
      argCount <= 100,
      `jsonb_build_object must receive <= 100 arguments, saw ${argCount}: ${call.slice(0, 120)}`,
    );
  }
});

test("web and native Ready Gate hydration are snapshot-first with raw reads only as fallback", () => {
  for (const [label, source] of [
    ["web ready gate", webReadyGate],
    ["native ready gate", nativeReadyGate],
  ] as const) {
    assert.match(source, /fetchVideoDateStartSnapshot/);
    assert.match(source, /const snapshot = await fetchVideoDateStartSnapshot\(sessionId\)/);
    assert.match(source, /const snapshotResult = await applyStartSnapshot\(snapshot\)/);
    assert.match(source, /partner profile display lookup degraded/);
    assert.ok(
      source.indexOf("fetchVideoDateStartSnapshot(sessionId)") <
        source.indexOf(".from(\"video_sessions\")") ||
        source.indexOf("fetchVideoDateStartSnapshot(sessionId)") <
        source.indexOf(".from('video_sessions')"),
      `${label} should try the startup snapshot before the legacy raw table fallback`,
    );
  }
});

test("shared route truth, ready redirects, and active-session hydration use startup snapshot", () => {
  assert.match(webTruth, /fetchVideoDateStartSnapshot\(sessionId\)[\s\S]*videoDateStartSnapshotToDateEntryTruth/);
  assert.match(webTruth, /event_id, participant_1_id, participant_2_id[\s\S]*date_started_at[\s\S]*participant_1_remote_seen_at/);
  assert.match(nativeVideoDateApi, /fetchVideoDateStartSnapshot\(sessionId\)[\s\S]*videoDateStartSnapshotToDateEntryTruth/);
  assert.match(webReadyRedirect, /fetchVideoDateStartSnapshot\(candidate\)/);
  assert.doesNotMatch(webReadyRedirect, /\.from\("video_sessions"\)/);
  assert.match(nativeReadyRoute, /fetchVideoDateStartSnapshot\(String\(sessionId\)\)/);
  assert.match(webActiveSession, /fetchVideoDateStartSnapshot\(reg\.current_room_id as string\)/);
  assert.match(nativeActiveSession, /fetchVideoDateStartSnapshot\(reg\.current_room_id as string\)/);
});

test("startup snapshot truth prefers normalized server phase over raw table phase", () => {
  const truth = videoDateStartSnapshotToDateEntryTruth({
    ok: true,
    error: null,
    retryable: true,
    terminal: false,
    sessionId: "session-1",
    eventId: "event-1",
    partnerId: "partner-1",
    readyGateStatus: "both_ready",
    canMarkReady: false,
    canEnterDate: true,
    raw: {
      session_id: "session-1",
      event_id: "event-1",
      phase: "queued",
      normalized_phase: "date",
      ready_gate_status: "both_ready",
    },
  });

  assert.equal(truth?.phase, "date");
});

test("Ready Gate overlay avoids startup raw session reads and respects mobile safe area", () => {
  assert.match(webOverlay, /fetchVideoDateStartSnapshot\(sessionId\)/);
  assert.match(webOverlay, /fetchVideoSessionDateEntryTruthCoalesced\(sessionId\)/);
  assert.doesNotMatch(webOverlay, /\.from\("video_sessions"\)[\s\S]{0,180}\.select\("participant_1_id, participant_2_id"\)/);
  assert.match(webOverlay, /result\.isTerminal === true[\s\S]*return/);
  assert.match(nativeOverlay, /result\.isTerminal === true[\s\S]*return/);
  assert.match(nativeReadyRoute, /result\.isTerminal === true[\s\S]*return/);
  assert.match(webOverlay, /items-start justify-center[\s\S]*sm:items-center/);
  assert.match(webOverlay, /minHeight: "100svh"/);
  assert.match(webOverlay, /safe-area-inset-top/);
});

function extractJsonbBuildObjectCalls(source: string): string[] {
  const calls: string[] = [];
  const token = "jsonb_build_object(";
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const start = source.indexOf(token, searchFrom);
    if (start === -1) break;

    const openParen = start + "jsonb_build_object".length;
    let depth = 0;
    let inString = false;
    let foundEnd = false;

    for (let index = openParen; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];

      if (inString) {
        if (char === "'" && next === "'") {
          index += 1;
          continue;
        }
        if (char === "'") inString = false;
        continue;
      }

      if (char === "'") {
        inString = true;
        continue;
      }

      if (char === "(") {
        depth += 1;
        continue;
      }

      if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          calls.push(source.slice(start, index + 1));
          searchFrom = index + 1;
          foundEnd = true;
          break;
        }
      }
    }

    if (!foundEnd) {
      searchFrom = start + token.length;
    }
  }

  return calls;
}

function countTopLevelArgs(call: string): number {
  const openParen = call.indexOf("(");
  const closeParen = call.lastIndexOf(")");
  const args = call.slice(openParen + 1, closeParen).trim();
  if (!args) return 0;

  let depth = 0;
  let inString = false;
  let count = 1;

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];
    const next = args[index + 1];

    if (inString) {
      if (char === "'" && next === "'") {
        index += 1;
        continue;
      }
      if (char === "'") inString = false;
      continue;
    }

    if (char === "'") {
      inString = true;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      continue;
    }

    if (char === "," && depth === 0) {
      count += 1;
    }
  }

  return count;
}
