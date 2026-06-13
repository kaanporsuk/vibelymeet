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

// options.fresh bypasses the 300ms reuse window and the shared in-flight read
// for post-mutation truth verification (review P2 on PR #1300): an entry
// Vibe/Pass or complete-entry verification must never confirm against a
// pre-mutation snapshot another date-route poller cached moments earlier.
export async function fetchVideoDateStartSnapshot(
  sessionId: string,
  options?: { fresh?: boolean },
): Promise<VideoDateStartSnapshot> {
  if (!options?.fresh) {
    const recent = snapshotRecent.get(sessionId);
    if (recent && Date.now() - recent.at <= SNAPSHOT_REUSE_MS) {
      return recent.snapshot;
    }

    const existing = snapshotInFlight.get(sessionId);
    if (existing) return existing;
  }

  const request = (async () => {
    // Stamp the cache with issue time so an older default read cannot overwrite
    // a newer fresh read's result; mirrors fetchVideoDateSessionRow.
    const startedAt = Date.now();
    const snapshot = await fetchVideoDateStartSnapshotUncached(sessionId);
    if (snapshot.ok) {
      const existing = snapshotRecent.get(sessionId);
      if (!existing || existing.at <= startedAt) {
        snapshotRecent.set(sessionId, { at: startedAt, snapshot });
        if (snapshotRecent.size > 16) {
          const oldest = snapshotRecent.keys().next().value;
          if (oldest !== undefined) snapshotRecent.delete(oldest);
        }
      }
    }
    return snapshot;
  })();

  // A fresh read bypasses reuse, so it must not be registered as the shared
  // in-flight request that concurrent default readers would otherwise adopt.
  if (options?.fresh) {
    return request;
  }

  snapshotInFlight.set(sessionId, request);
  try {
    return await request;
  } finally {
    if (snapshotInFlight.get(sessionId) === request) snapshotInFlight.delete(sessionId);
  }
}
