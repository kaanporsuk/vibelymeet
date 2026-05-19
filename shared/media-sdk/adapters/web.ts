import { defaultOffMediaFeatureFlagGate, mediaFlagForFamily, type MediaFeatureFlagGate } from "../core/flag-gate";
import {
  assertMediaUploadQueueSourceBinding,
  matchesMediaUploadQueueFilter,
  MemoryMediaUploadQueue,
  type MediaUploadQueue,
  type MediaUploadQueueFilter,
  type MediaUploadQueueRecord,
} from "../core/queue";
import { createMediaTelemetry, type MediaTelemetry, type MediaTelemetrySink } from "../core/telemetry";
import { createMediaUploadTask, type MediaTaskRunContext } from "../core/task";
import type {
  MediaPhotoUploadInput,
  MediaUploadInput,
  MediaUploadSnapshot,
  MediaUploadTask,
  MediaVideoUploadInput,
  MediaVoiceUploadInput,
} from "../core/types";

export type WebMediaSource = File | Blob;
export type WebMediaUploadInput = MediaUploadInput<WebMediaSource>;
export type WebVideoUploadInput = MediaVideoUploadInput<WebMediaSource>;
export type WebPhotoUploadInput = MediaPhotoUploadInput<WebMediaSource>;
export type WebVoiceUploadInput = MediaVoiceUploadInput<WebMediaSource>;
export type WebMediaSdk = {
  video: {
    upload: (input: WebVideoUploadInput) => MediaUploadTask;
  };
  photo: {
    upload: (input: WebPhotoUploadInput) => MediaUploadTask;
  };
  voice: {
    upload: (input: WebVoiceUploadInput) => MediaUploadTask;
  };
};
export type WebMediaUploadDelegate<TInput extends WebMediaUploadInput = WebMediaUploadInput> = (
  input: TInput,
  controls: MediaTaskRunContext,
) => Promise<void> | void;

export type WebLegacyMediaDelegates = {
  video?: {
    uploadVibeVideo?: WebMediaUploadDelegate<WebVideoUploadInput & { family: "vibe_video" }>;
    uploadChatVibeClip?: WebMediaUploadDelegate<WebVideoUploadInput & { family: "chat_vibe_clip" }>;
  };
  photo?: {
    uploadProfilePhoto?: WebMediaUploadDelegate<WebPhotoUploadInput & { family: "profile_photo" }>;
    uploadChatPhoto?: WebMediaUploadDelegate<WebPhotoUploadInput & { family: "chat_photo" }>;
    uploadEventCover?: WebMediaUploadDelegate<WebPhotoUploadInput & { family: "event_cover" }>;
  };
  voice?: {
    uploadVoiceNote?: WebMediaUploadDelegate<WebVoiceUploadInput>;
  };
};

export type WebMediaSdkOptions = {
  queue?: MediaUploadQueue;
  flagGate?: MediaFeatureFlagGate;
  telemetry?: MediaTelemetry;
  telemetrySinks?: readonly MediaTelemetrySink[];
  delegates?: WebLegacyMediaDelegates;
};

export function assertWebMediaSource(source: WebMediaSource): void {
  if (typeof Blob === "undefined" || !(source instanceof Blob)) {
    throw new Error("web_media_blob_required");
  }
}

function sourceRefForWebSource(source: WebMediaSource): string {
  assertWebMediaSource(source);
  const maybeFile = source as File;
  const name = typeof maybeFile.name === "string" && maybeFile.name ? maybeFile.name : "blob";
  const type = typeof source.type === "string" && source.type ? source.type : "application/octet-stream";
  return `${name}:${type}:${source.size}`;
}

function scopeKeyForInput(input: WebMediaUploadInput): string | null {
  return input.context?.scopeKey ?? null;
}

function sourceSha256ForInput(input: WebMediaUploadInput): string | null {
  const value = input.options?.sourceSha256;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordForSnapshot(input: WebMediaUploadInput, snapshot: MediaUploadSnapshot): MediaUploadQueueRecord {
  return {
    id: snapshot.id,
    clientRequestId: snapshot.clientRequestId,
    family: input.family,
    state: snapshot.state,
    sourceRef: sourceRefForWebSource(input.source),
    sourceSha256: sourceSha256ForInput(input),
    scopeKey: scopeKeyForInput(input),
    createdAtMs: snapshot.createdAtMs,
    updatedAtMs: snapshot.updatedAtMs,
    snapshot,
    metadata: {
      adapter: "web",
      source_type: typeof File !== "undefined" && input.source instanceof File ? "file" : "blob",
    },
  };
}

function delegateForInput(input: WebMediaUploadInput, delegates: WebLegacyMediaDelegates | undefined) {
  switch (input.family) {
    case "vibe_video":
      return delegates?.video?.uploadVibeVideo as WebMediaUploadDelegate | undefined;
    case "chat_vibe_clip":
      return delegates?.video?.uploadChatVibeClip as WebMediaUploadDelegate | undefined;
    case "profile_photo":
      return delegates?.photo?.uploadProfilePhoto as WebMediaUploadDelegate | undefined;
    case "chat_photo":
      return delegates?.photo?.uploadChatPhoto as WebMediaUploadDelegate | undefined;
    case "event_cover":
      return delegates?.photo?.uploadEventCover as WebMediaUploadDelegate | undefined;
    case "voice_note":
      return delegates?.voice?.uploadVoiceNote as WebMediaUploadDelegate | undefined;
  }
}

async function syncQueueSnapshot(
  queue: MediaUploadQueue,
  taskId: string,
  snapshot: MediaUploadSnapshot,
): Promise<void> {
  if (snapshot.state === "ready") {
    await queue.remove(taskId);
    return;
  }
  if (snapshot.state === "cancelled") {
    await queue.remove(taskId);
    return;
  }
  await queue.update(taskId, {
    state: snapshot.state,
    updatedAtMs: snapshot.updatedAtMs,
    snapshot,
  });
}

function createWebUploadTask(input: WebMediaUploadInput, options: Required<WebMediaSdkOptions>): MediaUploadTask {
  const task = createMediaUploadTask({
    input,
    platform: "web",
    telemetry: options.telemetry,
    runner: async (controls) => {
      const flag = mediaFlagForFamily(input.family);
      const enabled = await options.flagGate.isEnabled(flag, input);
      controls.emitTelemetry("media_upload_sdk_flag_evaluated", {
        flag,
        enabled,
        adapter: "web",
      });
      if (!enabled) {
        controls.dispatch({
          type: "fail",
          error: {
            code: "media_feature_disabled",
            message: `${flag} is disabled`,
            retryable: false,
          },
        });
        return;
      }

      const delegate = delegateForInput(input, options.delegates);
      if (!delegate) {
        controls.dispatch({
          type: "fail",
          error: {
            code: "media_delegate_missing",
            message: `No web media delegate registered for ${input.family}`,
            retryable: false,
          },
        });
        return;
      }

      await delegate(input, controls);
      if (controls.snapshot().state === "uploading") {
        controls.dispatch({ type: "upload_complete" });
      }
    },
    beforeStart: async (snapshot, currentSnapshot) => {
      await assertMediaUploadQueueSourceBinding({
        queue: options.queue,
        family: input.family,
        scopeKey: scopeKeyForInput(input),
        clientRequestId: snapshot.clientRequestId,
        sourceSha256: sourceSha256ForInput(input),
      });
      await options.queue.put(recordForSnapshot(input, snapshot));
      const latest = currentSnapshot();
      if (latest !== snapshot) await syncQueueSnapshot(options.queue, latest.id, latest);
    },
  });

  task.on("state", (snapshot) => {
    void syncQueueSnapshot(options.queue, task.id, snapshot);
  });
  task.on("progress", (snapshot) => {
    void syncQueueSnapshot(options.queue, task.id, snapshot);
  });

  return task;
}

function withWebDefaults(options: WebMediaSdkOptions): Required<WebMediaSdkOptions> {
  return {
    queue: options.queue ?? createIndexedDbMediaUploadQueue(),
    flagGate: options.flagGate ?? defaultOffMediaFeatureFlagGate,
    telemetry: options.telemetry ?? createMediaTelemetry(options.telemetrySinks),
    telemetrySinks: options.telemetrySinks ?? [],
    delegates: options.delegates ?? {},
  };
}

export function createWebMediaSdk(options: WebMediaSdkOptions = {}): WebMediaSdk {
  const resolved = withWebDefaults(options);
  return {
    video: {
      upload: (input) => createWebUploadTask(input as WebMediaUploadInput, resolved),
    },
    photo: {
      upload: (input) => createWebUploadTask(input as WebMediaUploadInput, resolved),
    },
    voice: {
      upload: (input) => createWebUploadTask(input as WebMediaUploadInput, resolved),
    },
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb_request_failed"));
  });
}

export class IndexedDbMediaUploadQueue implements MediaUploadQueue {
  private readonly fallback = new MemoryMediaUploadQueue();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor(
    private readonly dbName = "vibely.upload-queue",
    private readonly storeName = "uploads",
  ) {}

  private async db(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return null;
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.dbPromise;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
    const db = await this.db();
    if (!db) return null;
    return db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  async put(record: MediaUploadQueueRecord): Promise<void> {
    try {
      const store = await this.store("readwrite");
      if (!store) return this.fallback.put(record);
      await requestToPromise(store.put(record));
      await this.fallback.remove(record.id);
    } catch {
      await this.fallback.put(record);
    }
  }

  async get(id: string): Promise<MediaUploadQueueRecord | null> {
    const fallbackRecord = await this.fallback.get(id);
    if (fallbackRecord) return fallbackRecord;
    try {
      const store = await this.store("readonly");
      if (!store) return this.fallback.get(id);
      const value = await requestToPromise<MediaUploadQueueRecord | undefined>(store.get(id));
      return value ?? (await this.fallback.get(id));
    } catch {
      return this.fallback.get(id);
    }
  }

  async update(
    id: string,
    patch: Partial<Omit<MediaUploadQueueRecord, "id">>,
  ): Promise<MediaUploadQueueRecord | null> {
    const current = await this.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    await this.put(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    try {
      const store = await this.store("readwrite");
      if (!store) return this.fallback.remove(id);
      await requestToPromise(store.delete(id));
      await this.fallback.remove(id);
    } catch {
      await this.fallback.remove(id);
    }
  }

  async list(filter: MediaUploadQueueFilter = {}): Promise<MediaUploadQueueRecord[]> {
    try {
      const store = await this.store("readonly");
      if (!store) return this.fallback.list(filter);
      const rowsById = new Map<string, MediaUploadQueueRecord>();
      for (const row of await requestToPromise<MediaUploadQueueRecord[]>(store.getAll())) {
        rowsById.set(row.id, row);
      }
      for (const row of await this.fallback.list(filter)) {
        rowsById.set(row.id, row);
      }
      return [...rowsById.values()]
        .filter((record) => matchesMediaUploadQueueFilter(record, filter))
        .sort((a, b) => a.createdAtMs - b.createdAtMs);
    } catch {
      return this.fallback.list(filter);
    }
  }
}

export function createIndexedDbMediaUploadQueue(): MediaUploadQueue {
  return new IndexedDbMediaUploadQueue();
}

export const webMediaTranscodeStubs = {
  async preparePhotoForUpload<TSource extends WebMediaSource>(source: TSource): Promise<TSource> {
    return source;
  },
  async prepareVoiceForUpload<TSource extends WebMediaSource>(source: TSource): Promise<TSource> {
    return source;
  },
  capabilities() {
    return {
      canvas: typeof HTMLCanvasElement !== "undefined",
      webCodecs: "VideoEncoder" in globalThis,
      phase: "phase_5_stub",
    };
  },
};
