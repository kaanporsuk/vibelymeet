import type { ClientFeatureFlagKey } from "./clientFeatureFlagCore";

// Golden-flow lean pass: /date mount evaluates ~12 client flags whose cache
// entries expire together (shared 60s TTL), producing a burst of 12
// evaluate_client_feature_flag_detail RPCs. The batch RPC
// (evaluate_client_feature_flags) already exists server-side; this collector
// coalesces concurrent single-flag cache misses into ONE batch call without
// changing clientFeatureFlagCore evaluation, caching, or sequencing semantics
// (it is a drop-in fetchDetail implementation). If the batch call fails, each
// queued flag falls back to its original single-detail fetch.

type DetailFetcher = (flag: ClientFeatureFlagKey, userId: string) => Promise<unknown>;
type BatchFetcher = (flags: readonly ClientFeatureFlagKey[], userId: string) => Promise<unknown>;

type Waiter = {
  resolve: (row: unknown) => void;
};

type PendingBatch = {
  flags: Map<ClientFeatureFlagKey, Waiter[]>;
  timer: ReturnType<typeof setTimeout>;
};

const BATCH_WINDOW_MS = 25;

function extractRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return Array.isArray(record.flags) ? record.flags : [];
}

function rowFlag(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const flag = (row as Record<string, unknown>).flag;
  return typeof flag === "string" ? flag : null;
}

export function createBatchedFlagDetailFetcher({
  fetchBatch,
  fetchDetail,
  windowMs = BATCH_WINDOW_MS,
}: {
  fetchBatch: BatchFetcher;
  fetchDetail: DetailFetcher;
  windowMs?: number;
}): DetailFetcher {
  const pendingByUser = new Map<string, PendingBatch>();

  async function runBatch(userId: string): Promise<void> {
    const pending = pendingByUser.get(userId);
    if (!pending) return;
    pendingByUser.delete(userId);
    clearTimeout(pending.timer);

    const flags = [...pending.flags.keys()];
    try {
      const raw = await fetchBatch(flags, userId);
      const rowsByFlag = new Map<string, unknown>();
      for (const row of extractRows(raw)) {
        const flag = rowFlag(row);
        if (flag) rowsByFlag.set(flag, row);
      }
      for (const [flag, waiters] of pending.flags) {
        const row = rowsByFlag.get(flag) ?? null;
        for (const waiter of waiters) waiter.resolve(row);
      }
    } catch {
      // Batch path degraded: recover each flag through its original
      // single-detail fetch so flag behavior never depends on the batch RPC.
      for (const [flag, waiters] of pending.flags) {
        const fallback = fetchDetail(flag, userId).catch(() => null);
        for (const waiter of waiters) {
          void fallback.then((row) => waiter.resolve(row));
        }
      }
    }
  }

  return (flag: ClientFeatureFlagKey, userId: string): Promise<unknown> => {
    return new Promise<unknown>((resolve) => {
      let pending = pendingByUser.get(userId);
      if (!pending) {
        pending = {
          flags: new Map(),
          timer: setTimeout(() => {
            void runBatch(userId);
          }, windowMs),
        };
        pendingByUser.set(userId, pending);
      }
      const waiters = pending.flags.get(flag);
      if (waiters) {
        waiters.push({ resolve });
      } else {
        pending.flags.set(flag, [{ resolve }]);
      }
    });
  };
}
