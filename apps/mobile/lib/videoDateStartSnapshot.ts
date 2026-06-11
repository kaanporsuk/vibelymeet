import { supabase } from '@/lib/supabase';
import {
  normalizeVideoDateStartSnapshot,
  VIDEO_DATE_START_SNAPSHOT_RPC_NAME,
  type VideoDateStartSnapshot,
} from '@clientShared/matching/videoDateStartSnapshot';


// Golden-flow lean pass: several surfaces (ReadyGateOverlay, useReadyGate,
// useActiveSession, ReadyRedirect, session truth) poll the start snapshot
// concurrently during launch, producing overlapping duplicate RPCs in the
// same tick. Concurrent callers share one in-flight request, and an ok result
// is reused for 300ms — far below every poller's 1-3s cadence, so state
// transitions are still observed at full polling speed. Errors and not-ok
// snapshots are never memoized.
const SNAPSHOT_REUSE_MS = 300;
const snapshotInFlight = new Map<string, Promise<VideoDateStartSnapshot>>();
const snapshotRecent = new Map<string, { at: number; snapshot: VideoDateStartSnapshot }>();

async function fetchVideoDateStartSnapshotUncached(
  sessionId: string,
): Promise<VideoDateStartSnapshot> {
  if (!sessionId) {
    return normalizeVideoDateStartSnapshot({
      ok: false,
      error: 'missing_session_id',
      retryable: false,
      terminal: false,
    });
  }

  try {
    const { data, error } = await supabase.rpc(VIDEO_DATE_START_SNAPSHOT_RPC_NAME as never, {
      p_session_id: sessionId,
    } as never);
    if (error) {
      return normalizeVideoDateStartSnapshot({
        ok: false,
        error: error.message || 'start_snapshot_rpc_error',
        error_code: error.code ?? null,
        details: error.details ?? null,
        hint: error.hint ?? null,
        retryable: true,
        terminal: false,
      });
    }
    return normalizeVideoDateStartSnapshot(data);
  } catch (error) {
    return normalizeVideoDateStartSnapshot({
      ok: false,
      error: error instanceof Error ? error.message : 'start_snapshot_rpc_error',
      retryable: true,
      terminal: false,
    });
  }
}

export async function fetchVideoDateStartSnapshot(
  sessionId: string,
): Promise<VideoDateStartSnapshot> {
  const recent = snapshotRecent.get(sessionId);
  if (recent && Date.now() - recent.at <= SNAPSHOT_REUSE_MS) {
    return recent.snapshot;
  }

  const existing = snapshotInFlight.get(sessionId);
  if (existing) return existing;

  const request = (async () => {
    const snapshot = await fetchVideoDateStartSnapshotUncached(sessionId);
    if (snapshot.ok) {
      snapshotRecent.set(sessionId, { at: Date.now(), snapshot });
      if (snapshotRecent.size > 16) {
        const oldest = snapshotRecent.keys().next().value;
        if (oldest !== undefined) snapshotRecent.delete(oldest);
      }
    }
    return snapshot;
  })();

  snapshotInFlight.set(sessionId, request);
  try {
    return await request;
  } finally {
    if (snapshotInFlight.get(sessionId) === request) snapshotInFlight.delete(sessionId);
  }
}
