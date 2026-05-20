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
import { transitionMediaUploadState } from "../core/state-machine";
import {
  DEFAULT_MEDIA_UPLOAD_STALE_SWEEP_GRACE_MS,
  reconcileMediaUploadQueue,
  type MediaUploadQueueReconciler,
  type MediaUploadReconcileResult,
} from "../core/reconcile";
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
    rehydrate: (record: MediaUploadQueueRecord) => MediaUploadTask;
  };
  photo: {
    upload: (input: WebPhotoUploadInput) => MediaUploadTask;
    rehydrate: (record: MediaUploadQueueRecord) => MediaUploadTask;
  };
  voice: {
    upload: (input: WebVoiceUploadInput) => MediaUploadTask;
    rehydrate: (record: MediaUploadQueueRecord) => MediaUploadTask;
  };
  reconcile: (options?: { reason?: string; resume?: boolean }) => Promise<MediaUploadReconcileResult>;
};
export type WebMediaUploadDelegate<TInput extends WebMediaUploadInput = WebMediaUploadInput> = (
  input: TInput,
  controls: MediaTaskRunContext,
) => Promise<void> | void;
export type WebPhotoTranscoder = (
  source: WebMediaSource,
  input: WebPhotoUploadInput,
) => Promise<WebMediaSource> | WebMediaSource;
export type WebVoiceRecorderConfig = {
  constraints: MediaStreamConstraints;
  options: MediaRecorderOptions;
  mimeType: string | null;
  audioBitsPerSecond: number;
  numberOfChannels: number;
};

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
  telemetry?: MediaTelemetry;
  telemetrySinks?: readonly MediaTelemetrySink[];
  reconciler?: MediaUploadQueueReconciler | null;
  staleSweepGracePeriodMs?: number;
  delegates?: WebLegacyMediaDelegates;
  photoTranscoder?: WebPhotoTranscoder | null;
};

type ResolvedWebMediaSdkOptions = {
  queue: MediaUploadQueue;
  telemetry: MediaTelemetry;
  telemetrySinks: readonly MediaTelemetrySink[];
  reconciler: MediaUploadQueueReconciler | null;
  staleSweepGracePeriodMs: number;
  delegates: WebLegacyMediaDelegates;
  photoTranscoder: WebPhotoTranscoder | null;
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

function optionalStringRecordValue(input: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = input?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function matchIdFromScopeKey(scopeKey: string | null): string | null {
  if (!scopeKey?.startsWith("match:")) return null;
  const matchId = scopeKey.slice("match:".length).trim();
  return matchId || null;
}

function normalizedProfileUploadContext(value: string | null | undefined): string | null {
  const context = value?.trim();
  if (context === "onboarding") return "onboarding";
  if (context === "profile_studio" || context === "self") return "profile_studio";
  return null;
}

function profileContextFromScopeKey(scopeKey: string | null): string | null {
  if (!scopeKey?.startsWith("profile:")) return null;
  const parts = scopeKey.split(":");
  if (parts.length === 2) return normalizedProfileUploadContext(parts[1]);
  return parts.length >= 3 ? normalizedProfileUploadContext(parts.slice(2).join(":")) : null;
}

function recordForSnapshot(input: WebMediaUploadInput, snapshot: MediaUploadSnapshot): MediaUploadQueueRecord {
  const uploadContext = optionalStringRecordValue(input.context, "uploadContext");
  const matchId = optionalStringRecordValue(input.context, "matchId") ?? matchIdFromScopeKey(scopeKeyForInput(input));
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
      source_blob: input.source,
      mime_type: input.source.type || null,
      upload_context: uploadContext,
      match_id: matchId,
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

function isPhotoUploadInput(input: WebMediaUploadInput): input is WebPhotoUploadInput {
  return input.family === "profile_photo" || input.family === "chat_photo" || input.family === "event_cover";
}

async function inputWithPreparedPhotoSource(
  input: WebMediaUploadInput,
  options: ResolvedWebMediaSdkOptions,
): Promise<WebMediaUploadInput> {
  if (!isPhotoUploadInput(input) || !options.photoTranscoder) return input;
  const preparedSource = await options.photoTranscoder(input.source, input);
  assertWebMediaSource(preparedSource);
  if (preparedSource === input.source) return input;
  return { ...input, source: preparedSource };
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

function placeholderWebSourceForRecord(record: MediaUploadQueueRecord): WebMediaSource {
  if (typeof Blob !== "undefined" && record.metadata?.source_blob instanceof Blob) {
    return record.metadata.source_blob;
  }
  if (typeof Blob === "undefined") {
    return {} as WebMediaSource;
  }
  const type = typeof record.metadata?.mime_type === "string" ? record.metadata.mime_type : "application/octet-stream";
  return new Blob([], { type });
}

function inputFromWebQueueRecord(record: MediaUploadQueueRecord): WebMediaUploadInput {
  const uploadContext = optionalStringRecordValue(record.metadata, "upload_context")
    ?? (record.family === "chat_photo" || record.family === "voice_note" ? "chat" : profileContextFromScopeKey(record.scopeKey));
  const matchId = optionalStringRecordValue(record.metadata, "match_id") ?? matchIdFromScopeKey(record.scopeKey);
  return {
    family: record.family,
    source: placeholderWebSourceForRecord(record),
    context: {
      scopeKey: record.scopeKey,
      rehydrated: true,
      ...(uploadContext ? { uploadContext } : {}),
      ...(matchId ? { matchId } : {}),
      ...(typeof record.metadata?.mime_type === "string" ? { mimeType: record.metadata.mime_type } : {}),
    },
    options: {
      clientRequestId: record.clientRequestId,
      sourceSha256: record.sourceSha256 ?? null,
    },
  };
}

function createWebUploadTask(input: WebMediaUploadInput, options: ResolvedWebMediaSdkOptions): MediaUploadTask {
  const task = createMediaUploadTask({
    input,
    platform: "web",
    telemetry: options.telemetry,
    runner: async (controls) => {
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

      const delegateInput = await inputWithPreparedPhotoSource(input, options);
      await delegate(delegateInput, controls);
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

function rehydrateWebUploadTask(record: MediaUploadQueueRecord, options: ResolvedWebMediaSdkOptions): MediaUploadTask {
  const input = inputFromWebQueueRecord(record);
  const task = createMediaUploadTask({
    id: record.id,
    initialSnapshot: record.snapshot,
    autoStart: false,
    input,
    platform: "web",
    telemetry: options.telemetry,
    runner: async (controls) => {
      if (!(typeof Blob !== "undefined" && input.source instanceof Blob) || input.source.size === 0) {
        controls.dispatch({
          type: "fail",
          error: {
            code: "media_rehydrate_source_missing",
            message: "The original browser upload source is no longer available.",
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
      const delegateInput = await inputWithPreparedPhotoSource(input, options);
      await delegate(delegateInput, controls);
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

const RECOVERABLE_REHYDRATE_STATES = ["created", "uploading", "paused"] as const;

function hasWebRehydrateSource(record: MediaUploadQueueRecord): boolean {
  return Boolean(typeof Blob !== "undefined" && record.metadata?.source_blob instanceof Blob && record.metadata.source_blob.size > 0);
}

async function failMissingWebRehydrateSource(options: ResolvedWebMediaSdkOptions, record: MediaUploadQueueRecord): Promise<void> {
  const snapshot = transitionMediaUploadState(record.snapshot, {
    type: "fail",
    error: {
      code: "media_rehydrate_source_missing",
      message: "The original browser upload source is no longer available.",
      retryable: false,
    },
  });
  await options.queue.update(record.id, {
    state: snapshot.state,
    updatedAtMs: snapshot.updatedAtMs,
    snapshot,
  });
  options.telemetry.emit({
    name: "media_upload_rehydrate_source_missing",
    family: record.family,
    platform: record.snapshot.platform,
    state: snapshot.state,
    clientRequestId: record.clientRequestId,
    fields: { adapter: "web" },
  });
}

async function resumeRecoverableWebUploads(
  options: ResolvedWebMediaSdkOptions,
  activeTaskIds: Set<string>,
): Promise<void> {
  const records = await options.queue.list({ states: RECOVERABLE_REHYDRATE_STATES });
  for (const record of records) {
    if (activeTaskIds.has(record.id)) continue;
    if (!hasWebRehydrateSource(record)) {
      await failMissingWebRehydrateSource(options, record);
      continue;
    }
    const task = rehydrateWebUploadTask(record, options);
    activeTaskIds.add(record.id);
    task.on("state", (snapshot) => {
      if (snapshot.state === "ready" || snapshot.state === "failed" || snapshot.state === "cancelled") {
        activeTaskIds.delete(record.id);
      }
    });
    void task.retry().catch((error) => {
      activeTaskIds.delete(record.id);
      options.telemetry.exception(error, {
        family: record.family,
        platform: record.snapshot.platform,
        client_request_id: record.clientRequestId,
        reason: "rehydrate_retry_failed",
      });
    });
  }
}

function withWebDefaults(options: WebMediaSdkOptions): ResolvedWebMediaSdkOptions {
  return {
    queue: options.queue ?? createIndexedDbMediaUploadQueue(),
    telemetry: options.telemetry ?? createMediaTelemetry(options.telemetrySinks),
    telemetrySinks: options.telemetrySinks ?? [],
    reconciler: options.reconciler ?? null,
    staleSweepGracePeriodMs: options.staleSweepGracePeriodMs ?? DEFAULT_MEDIA_UPLOAD_STALE_SWEEP_GRACE_MS,
    delegates: options.delegates ?? {},
    photoTranscoder: options.photoTranscoder === undefined ? webMediaTranscode.preparePhotoForUpload : options.photoTranscoder,
  };
}

export function createWebMediaSdk(options: WebMediaSdkOptions = {}): WebMediaSdk {
  const resolved = withWebDefaults(options);
  const activeRehydratedTaskIds = new Set<string>();
  return {
    video: {
      upload: (input) => createWebUploadTask(input as WebMediaUploadInput, resolved),
      rehydrate: (record) => rehydrateWebUploadTask(record, resolved),
    },
    photo: {
      upload: (input) => createWebUploadTask(input as WebMediaUploadInput, resolved),
      rehydrate: (record) => rehydrateWebUploadTask(record, resolved),
    },
    voice: {
      upload: (input) => createWebUploadTask(input as WebMediaUploadInput, resolved),
      rehydrate: (record) => rehydrateWebUploadTask(record, resolved),
    },
    reconcile: async (options) => {
      const result = await reconcileMediaUploadQueue({
        queue: resolved.queue,
        reconciler: resolved.reconciler,
        telemetry: resolved.telemetry,
        staleSweepGracePeriodMs: resolved.staleSweepGracePeriodMs,
        reason: options?.reason,
      });
      if (options?.resume !== false) await resumeRecoverableWebUploads(resolved, activeRehydratedTaskIds);
      return result;
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

  async findByClientRequestId(clientRequestId: string, scopeKey?: string | null): Promise<MediaUploadQueueRecord | null> {
    const fallbackRecord = await this.fallback.findByClientRequestId(clientRequestId, scopeKey);
    if (fallbackRecord) return fallbackRecord;
    const rows = await this.list(scopeKey === undefined ? {} : { scopeKey });
    return rows.find((record) => record.clientRequestId === clientRequestId) ?? null;
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

type Heic2Any = (options: {
  blob: Blob;
  toType?: string;
  quality?: number;
  multiple?: true;
}) => Promise<Blob | Blob[]>;

type WebPhotoCanvasSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

function normalizedWebMediaType(source: WebMediaSource): string {
  return typeof source.type === "string" ? source.type.split(";")[0].trim().toLowerCase() : "";
}

function webMediaSourceName(source: WebMediaSource): string {
  const maybeFile = source as File;
  return typeof maybeFile.name === "string" ? maybeFile.name.trim() : "";
}

function isHeicWebSource(source: WebMediaSource): boolean {
  const type = normalizedWebMediaType(source);
  if (type === "image/heic" || type === "image/heif") return true;
  return /\.(heic|heif)$/i.test(webMediaSourceName(source));
}

function isImageWebSource(source: WebMediaSource): boolean {
  const type = normalizedWebMediaType(source);
  return type.startsWith("image/") || (!type && isHeicWebSource(source));
}

function webPhotoFileName(source: WebMediaSource): string {
  const rawName = webMediaSourceName(source) || "photo";
  return `${rawName.replace(/\.[^.]+$/, "") || "photo"}.jpg`;
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

function hasUsableImageSize(width: number, height: number): boolean {
  return width > 0 && height > 0;
}

function closeImageBitmap(bitmap: ImageBitmap | null): void {
  bitmap?.close?.();
}

function canvasSourceFromImageBitmap(bitmap: ImageBitmap | null): WebPhotoCanvasSource | null {
  if (!bitmap || !hasUsableImageSize(bitmap.width, bitmap.height)) {
    closeImageBitmap(bitmap);
    return null;
  }
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => closeImageBitmap(bitmap),
  };
}

async function canvasSourceFromImageElement(blob: Blob): Promise<WebPhotoCanvasSource | null> {
  if (
    typeof Image === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    return null;
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image_decode_failed"));
      image.src = objectUrl;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!hasUsableImageSize(width, height)) {
      URL.revokeObjectURL(objectUrl);
      return null;
    }
    return {
      source: image,
      width,
      height,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch {
    URL.revokeObjectURL(objectUrl);
    return null;
  }
}

async function convertHeicToJpegBlob(source: WebMediaSource): Promise<Blob | null> {
  try {
    const mod = await import("heic2any");
    const heic2any = mod.default as Heic2Any;
    const converted = await heic2any({ blob: source, toType: "image/jpeg", quality: 0.85 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return blob instanceof Blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

async function canvasSourceFromBlob(blob: Blob): Promise<WebPhotoCanvasSource | null> {
  if (typeof createImageBitmap === "function") {
    const bitmap = canvasSourceFromImageBitmap(await createImageBitmap(blob).catch(() => null));
    if (bitmap) return bitmap;
  }
  return canvasSourceFromImageElement(blob);
}

async function canvasSourceForWebPhotoSource(source: WebMediaSource): Promise<WebPhotoCanvasSource | null> {
  const directSource = await canvasSourceFromBlob(source);
  if (directSource) return directSource;

  if (!isHeicWebSource(source)) return null;
  const convertedHeic = await convertHeicToJpegBlob(source);
  if (!convertedHeic) return null;

  return canvasSourceFromBlob(convertedHeic);
}

const WEB_VOICE_AUDIO_BITS_PER_SECOND = 96_000;
const WEB_VOICE_CHANNEL_COUNT = 1;
const WEB_VOICE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
] as const;

function supportedWebVoiceMimeType(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return null;
  }
  return WEB_VOICE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export const webMediaTranscode = {
  async preparePhotoForUpload<TSource extends WebMediaSource>(source: TSource): Promise<WebMediaSource> {
    assertWebMediaSource(source);
    if (!isImageWebSource(source)) return source;
    if (typeof document === "undefined" || typeof HTMLCanvasElement === "undefined") {
      return source;
    }

    const decoded = await canvasSourceForWebPhotoSource(source);
    if (!decoded) return source;

    try {
      const maxEdge = 2048;
      const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
      const targetWidth = Math.max(1, Math.round(decoded.width * scale));
      const targetHeight = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return source;

      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(decoded.source, 0, 0, targetWidth, targetHeight);

      const blob = await canvasToBlob(canvas, "image/jpeg", 0.85);
      if (!blob || blob.size <= 0) return source;

      if (typeof File !== "undefined" && source instanceof File) {
        return new File([blob], webPhotoFileName(source), {
          type: "image/jpeg",
          lastModified: typeof source.lastModified === "number" ? source.lastModified : Date.now(),
        });
      }
      return new Blob([blob], { type: "image/jpeg" });
    } finally {
      decoded.close();
    }
  },
  async prepareVoiceForUpload<TSource extends WebMediaSource>(source: TSource): Promise<TSource> {
    return source;
  },
  voiceRecordingConfig(): WebVoiceRecorderConfig {
    const mimeType = supportedWebVoiceMimeType();
    return {
      constraints: {
        audio: {
          channelCount: { ideal: WEB_VOICE_CHANNEL_COUNT },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      },
      options: {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: WEB_VOICE_AUDIO_BITS_PER_SECOND,
      },
      mimeType,
      audioBitsPerSecond: WEB_VOICE_AUDIO_BITS_PER_SECOND,
      numberOfChannels: WEB_VOICE_CHANNEL_COUNT,
    };
  },
  capabilities() {
    return {
      canvas: typeof HTMLCanvasElement !== "undefined",
      webCodecs: "VideoEncoder" in globalThis,
      phase: "phase_5_photo_transcode",
      voice: {
        phase: "phase_5_voice_record_web",
        audioBitsPerSecond: WEB_VOICE_AUDIO_BITS_PER_SECOND,
        numberOfChannels: WEB_VOICE_CHANNEL_COUNT,
      },
    };
  },
};
