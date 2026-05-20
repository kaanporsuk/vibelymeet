import type { MediaUploadFamily, MediaUploadSnapshot, MediaUploadState } from "./types";

export type MediaUploadQueueRecord = {
  id: string;
  clientRequestId: string;
  family: MediaUploadFamily;
  state: MediaUploadState;
  sourceRef: string | null;
  sourceSha256?: string | null;
  scopeKey: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  snapshot: MediaUploadSnapshot;
  metadata?: Record<string, unknown>;
};

export type MediaUploadQueueFilter = {
  family?: MediaUploadFamily;
  states?: readonly MediaUploadState[];
  scopeKey?: string | null;
};

export interface MediaUploadQueue {
  put(record: MediaUploadQueueRecord): Promise<void>;
  get(id: string): Promise<MediaUploadQueueRecord | null>;
  findByClientRequestId(clientRequestId: string, scopeKey?: string | null): Promise<MediaUploadQueueRecord | null>;
  update(id: string, patch: Partial<Omit<MediaUploadQueueRecord, "id">>): Promise<MediaUploadQueueRecord | null>;
  remove(id: string): Promise<void>;
  list(filter?: MediaUploadQueueFilter): Promise<MediaUploadQueueRecord[]>;
}

export class MediaUploadQueueSourceConflictError extends Error {
  constructor(
    readonly clientRequestId: string,
    readonly scopeKey: string | null,
  ) {
    super("client_request_id is already bound to a different local media source");
    this.name = "media_client_request_source_conflict";
  }
}

export function matchesMediaUploadQueueFilter(
  record: MediaUploadQueueRecord,
  filter: MediaUploadQueueFilter = {},
): boolean {
  const states = filter.states ? new Set(filter.states) : null;
  return (
    (!filter.family || record.family === filter.family) &&
    (!states || states.has(record.state)) &&
    (filter.scopeKey === undefined || record.scopeKey === filter.scopeKey)
  );
}

export async function assertMediaUploadQueueSourceBinding(input: {
  queue: MediaUploadQueue;
  family: MediaUploadFamily;
  scopeKey: string | null;
  clientRequestId: string;
  sourceSha256: string | null;
}): Promise<void> {
  if (!input.sourceSha256) return;
  const rows = await input.queue.list({
    family: input.family,
    scopeKey: input.scopeKey,
  });
  const conflict = rows.find(
    (record) =>
      record.clientRequestId === input.clientRequestId &&
      !!record.sourceSha256 &&
      record.sourceSha256 !== input.sourceSha256,
  );
  if (conflict) {
    throw new MediaUploadQueueSourceConflictError(input.clientRequestId, input.scopeKey);
  }
}

export class MemoryMediaUploadQueue implements MediaUploadQueue {
  private readonly records = new Map<string, MediaUploadQueueRecord>();

  async put(record: MediaUploadQueueRecord): Promise<void> {
    this.records.set(record.id, { ...record });
  }

  async get(id: string): Promise<MediaUploadQueueRecord | null> {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  async findByClientRequestId(clientRequestId: string, scopeKey?: string | null): Promise<MediaUploadQueueRecord | null> {
    const rows = await this.list(scopeKey === undefined ? {} : { scopeKey });
    return rows.find((record) => record.clientRequestId === clientRequestId) ?? null;
  }

  async update(
    id: string,
    patch: Partial<Omit<MediaUploadQueueRecord, "id">>,
  ): Promise<MediaUploadQueueRecord | null> {
    const current = this.records.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    this.records.set(id, next);
    return { ...next };
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
  }

  async list(filter: MediaUploadQueueFilter = {}): Promise<MediaUploadQueueRecord[]> {
    return [...this.records.values()]
      .filter((record) => matchesMediaUploadQueueFilter(record, filter))
      .map((record) => ({ ...record }))
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
  }
}
