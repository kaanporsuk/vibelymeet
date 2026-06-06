export type VideoDateEntryOwnerState =
  | "idle"
  | "preparing"
  | "prepared"
  | "navigating"
  | "joining"
  | "joined"
  | "remote_seen"
  | "terminal"
  | "failed";

export type VideoDateDailyOwnerState =
  | "idle"
  | "joining"
  | "joined"
  | "remote_seen"
  | "lost"
  | "terminal"
  | "failed";

export type VideoDateEntryOwner = {
  ownerId: string;
  sessionId: string;
  userId: string;
  eventId?: string | null;
  state: VideoDateEntryOwnerState;
  source?: string | null;
  roomName?: string | null;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
  callInstanceId?: string | null;
  providerSessionId?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  lastFailureCode?: string | null;
  lastFailureMessage?: string | null;
};

export type VideoDateDailyOwner = {
  ownerId: string;
  sessionId: string;
  userId: string;
  roomName?: string | null;
  state: VideoDateDailyOwnerState;
  source?: string | null;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
  callInstanceId?: string | null;
  providerSessionId?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
};

export type VideoDateEntryOwnerClaim =
  | {
      ok: true;
      owner: VideoDateEntryOwner;
      created: boolean;
    }
  | {
      ok: false;
      reason: "active_owner";
      owner: VideoDateEntryOwner;
    };

const ENTRY_OWNER_ACTIVE_TTL_MS = 180_000;
const ENTRY_OWNER_TERMINAL_TTL_MS = 30_000;
const DAILY_OWNER_ACTIVE_TTL_MS = 90_000;
const DAILY_OWNER_TERMINAL_TTL_MS = 30_000;

const entryOwners = new Map<string, VideoDateEntryOwner>();
const dailyOwners = new Map<string, VideoDateDailyOwner>();
const dailySubscribers = new Set<(owner: VideoDateDailyOwner | null) => void>();

function ownerKey(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
}

function dailyOwnerKey(
  sessionId: string,
  userId: string,
  roomName?: string | null,
): string {
  return `${sessionId}:${userId}:${roomName ?? ""}`;
}

function randomOwnerId(prefix: string, nowMs: number): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return `${prefix}_${randomUUID()}`;
  const random = Math.random().toString(36).slice(2, 12);
  return `${prefix}_${nowMs.toString(36)}_${random}`;
}

function isEntryTerminal(state: VideoDateEntryOwnerState): boolean {
  return state === "terminal" || state === "failed";
}

function isDailyTerminal(state: VideoDateDailyOwnerState): boolean {
  return state === "terminal" || state === "failed" || state === "lost";
}

function entryTtlForState(state: VideoDateEntryOwnerState): number {
  return isEntryTerminal(state)
    ? ENTRY_OWNER_TERMINAL_TTL_MS
    : ENTRY_OWNER_ACTIVE_TTL_MS;
}

function dailyTtlForState(state: VideoDateDailyOwnerState): number {
  return isDailyTerminal(state)
    ? DAILY_OWNER_TERMINAL_TTL_MS
    : DAILY_OWNER_ACTIVE_TTL_MS;
}

function pruneEntryOwner(key: string, nowMs: number): VideoDateEntryOwner | null {
  const owner = entryOwners.get(key);
  if (!owner) return null;
  if (owner.expiresAtMs > nowMs && !isEntryTerminal(owner.state)) return owner;
  if (owner.expiresAtMs > nowMs && isEntryTerminal(owner.state)) return owner;
  entryOwners.delete(key);
  return null;
}

function pruneDailyOwner(key: string, nowMs: number): VideoDateDailyOwner | null {
  const owner = dailyOwners.get(key);
  if (!owner) return null;
  if (owner.expiresAtMs > nowMs) return owner;
  dailyOwners.delete(key);
  notifyDailyOwnerSubscribers(null);
  return null;
}

function notifyDailyOwnerSubscribers(owner: VideoDateDailyOwner | null): void {
  dailySubscribers.forEach((subscriber) => {
    try {
      subscriber(owner);
    } catch {
      // Subscribers are observational only.
    }
  });
}

export function claimVideoDateEntryOwner(input: {
  sessionId: string;
  userId: string;
  eventId?: string | null;
  source?: string | null;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
  state?: VideoDateEntryOwnerState;
  nowMs?: number;
}): VideoDateEntryOwnerClaim {
  const nowMs = input.nowMs ?? Date.now();
  const key = ownerKey(input.sessionId, input.userId);
  const existing = pruneEntryOwner(key, nowMs);
  if (existing && !isEntryTerminal(existing.state)) {
    return { ok: false, reason: "active_owner", owner: existing };
  }

  const state = input.state ?? "preparing";
  const owner: VideoDateEntryOwner = {
    ownerId: randomOwnerId("vdeo", nowMs),
    sessionId: input.sessionId,
    userId: input.userId,
    eventId: input.eventId ?? null,
    state,
    source: input.source ?? null,
    entryAttemptId: input.entryAttemptId ?? null,
    videoDateTraceId: input.videoDateTraceId ?? null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + entryTtlForState(state),
  };
  entryOwners.set(key, owner);
  return { ok: true, owner, created: true };
}

export function getVideoDateEntryOwner(
  sessionId: string,
  userId: string,
  nowMs: number = Date.now(),
): VideoDateEntryOwner | null {
  return pruneEntryOwner(ownerKey(sessionId, userId), nowMs);
}

export function updateVideoDateEntryOwnerState(input: {
  sessionId: string;
  userId: string;
  ownerId?: string | null;
  state: VideoDateEntryOwnerState;
  source?: string | null;
  roomName?: string | null;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
  callInstanceId?: string | null;
  providerSessionId?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  nowMs?: number;
}): VideoDateEntryOwner | null {
  const nowMs = input.nowMs ?? Date.now();
  const key = ownerKey(input.sessionId, input.userId);
  const existing = pruneEntryOwner(key, nowMs);
  if (!existing) return null;
  if (input.ownerId && input.ownerId !== existing.ownerId) return existing;

  const next: VideoDateEntryOwner = {
    ...existing,
    state: input.state,
    source: input.source ?? existing.source,
    roomName: input.roomName ?? existing.roomName ?? null,
    entryAttemptId: input.entryAttemptId ?? existing.entryAttemptId ?? null,
    videoDateTraceId: input.videoDateTraceId ?? existing.videoDateTraceId ?? null,
    callInstanceId: input.callInstanceId ?? existing.callInstanceId ?? null,
    providerSessionId: input.providerSessionId ?? existing.providerSessionId ?? null,
    lastFailureCode: input.failureCode ?? existing.lastFailureCode ?? null,
    lastFailureMessage: input.failureMessage ?? existing.lastFailureMessage ?? null,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + entryTtlForState(input.state),
  };
  entryOwners.set(key, next);
  return next;
}

export function releaseVideoDateEntryOwner(input: {
  sessionId: string;
  userId: string;
  ownerId?: string | null;
  force?: boolean;
}): boolean {
  const key = ownerKey(input.sessionId, input.userId);
  const existing = entryOwners.get(key);
  if (!existing) return false;
  if (!input.force && input.ownerId && existing.ownerId !== input.ownerId) {
    return false;
  }
  entryOwners.delete(key);
  return true;
}

export function updateVideoDateDailyOwnerState(input: {
  sessionId: string;
  userId: string;
  ownerId?: string | null;
  roomName?: string | null;
  state: VideoDateDailyOwnerState;
  source?: string | null;
  entryAttemptId?: string | null;
  videoDateTraceId?: string | null;
  callInstanceId?: string | null;
  providerSessionId?: string | null;
  nowMs?: number;
}): VideoDateDailyOwner {
  const nowMs = input.nowMs ?? Date.now();
  const key = dailyOwnerKey(input.sessionId, input.userId, input.roomName);
  const existing = pruneDailyOwner(key, nowMs);
  const ownerId =
    input.ownerId ??
    existing?.ownerId ??
    getVideoDateEntryOwner(input.sessionId, input.userId, nowMs)?.ownerId ??
    randomOwnerId("vddo", nowMs);
  const next: VideoDateDailyOwner = {
    ownerId,
    sessionId: input.sessionId,
    userId: input.userId,
    roomName: input.roomName ?? existing?.roomName ?? null,
    state: input.state,
    source: input.source ?? existing?.source ?? null,
    entryAttemptId: input.entryAttemptId ?? existing?.entryAttemptId ?? null,
    videoDateTraceId: input.videoDateTraceId ?? existing?.videoDateTraceId ?? null,
    callInstanceId: input.callInstanceId ?? existing?.callInstanceId ?? null,
    providerSessionId:
      input.providerSessionId ?? existing?.providerSessionId ?? null,
    createdAtMs: existing?.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + dailyTtlForState(input.state),
  };
  dailyOwners.set(key, next);
  notifyDailyOwnerSubscribers(next);
  return next;
}

export function getVideoDateDailyOwner(input: {
  sessionId: string;
  userId: string;
  roomName?: string | null;
  nowMs?: number;
}): VideoDateDailyOwner | null {
  return pruneDailyOwner(
    dailyOwnerKey(input.sessionId, input.userId, input.roomName),
    input.nowMs ?? Date.now(),
  );
}

export function subscribeVideoDateDailyOwner(
  subscriber: (owner: VideoDateDailyOwner | null) => void,
): () => void {
  dailySubscribers.add(subscriber);
  return () => {
    dailySubscribers.delete(subscriber);
  };
}
