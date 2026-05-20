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
import { mediaBackgroundUploadPolicyTelemetryFields } from "../background-upload-policy";
import type {
  MediaPhotoUploadInput,
  MediaUploadInput,
  MediaUploadSnapshot,
  MediaUploadTask,
  MediaVideoUploadInput,
  MediaVoiceUploadInput,
} from "../core/types";

export type NativeLocalUriSource = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
};

export type NativeMediaUploadInput = MediaUploadInput<NativeLocalUriSource>;
export type NativeVideoUploadInput = MediaVideoUploadInput<NativeLocalUriSource>;
export type NativePhotoUploadInput = MediaPhotoUploadInput<NativeLocalUriSource>;
export type NativeVoiceUploadInput = MediaVoiceUploadInput<NativeLocalUriSource>;
export type NativeMediaSdk = {
  video: {
    upload: (input: NativeVideoUploadInput) => MediaUploadTask;
    rehydrate: (record: MediaUploadQueueRecord) => MediaUploadTask;
  };
  photo: {
    upload: (input: NativePhotoUploadInput) => MediaUploadTask;
    rehydrate: (record: MediaUploadQueueRecord) => MediaUploadTask;
  };
  voice: {
    upload: (input: NativeVoiceUploadInput) => MediaUploadTask;
    rehydrate: (record: MediaUploadQueueRecord) => MediaUploadTask;
  };
  reconcile: (options?: { reason?: string; resume?: boolean }) => Promise<MediaUploadReconcileResult>;
};
export type NativeMediaUploadDelegate<TInput extends NativeMediaUploadInput = NativeMediaUploadInput> = (
  input: TInput,
  controls: MediaTaskRunContext,
) => Promise<void> | void;
export type NativePhotoTranscoder = (
  source: NativeLocalUriSource,
  input: NativePhotoUploadInput,
  imageManipulator?: NativeImageManipulatorLike | null,
) => Promise<NativeLocalUriSource> | NativeLocalUriSource;

export type NativeAsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type NativeFileSystemLike = {
  getInfoAsync(uri: string): Promise<{ exists: boolean; isDirectory?: boolean; size?: number | null }>;
  deleteAsync?: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
};

export type NativeImageManipulatorLike = {
  manipulateAsync: (uri: string, actions: readonly unknown[], options?: Record<string, unknown>) => Promise<NativeLocalUriSource>;
};

export type NativeAudioHooks = {
  preferredVoiceRecordingOptions?: Record<string, unknown>;
};

export type NativeLegacyMediaDelegates = {
  video?: {
    uploadVibeVideo?: NativeMediaUploadDelegate<NativeVideoUploadInput & { family: "vibe_video" }>;
    uploadChatVibeClip?: NativeMediaUploadDelegate<NativeVideoUploadInput & { family: "chat_vibe_clip" }>;
  };
  photo?: {
    uploadProfilePhoto?: NativeMediaUploadDelegate<NativePhotoUploadInput & { family: "profile_photo" }>;
    uploadChatPhoto?: NativeMediaUploadDelegate<NativePhotoUploadInput & { family: "chat_photo" }>;
    uploadEventCover?: NativeMediaUploadDelegate<NativePhotoUploadInput & { family: "event_cover" }>;
  };
  voice?: {
    uploadVoiceNote?: NativeMediaUploadDelegate<NativeVoiceUploadInput>;
  };
};

export type NativeMediaSdkOptions = {
  queue?: MediaUploadQueue;
  asyncStorage?: NativeAsyncStorageLike;
  fileSystem?: NativeFileSystemLike;
  imageManipulator?: NativeImageManipulatorLike;
  audio?: NativeAudioHooks;
  telemetry?: MediaTelemetry;
  telemetrySinks?: readonly MediaTelemetrySink[];
  reconciler?: MediaUploadQueueReconciler | null;
  staleSweepGracePeriodMs?: number;
  delegates?: NativeLegacyMediaDelegates;
  photoTranscoder?: NativePhotoTranscoder | null;
  platform?: "native" | "ios" | "android";
};

type ResolvedNativeMediaSdkOptions = {
  queue: MediaUploadQueue;
  asyncStorage: NativeAsyncStorageLike | null;
  fileSystem: NativeFileSystemLike | null;
  imageManipulator: NativeImageManipulatorLike | null;
  audio: NativeAudioHooks;
  telemetry: MediaTelemetry;
  telemetrySinks: readonly MediaTelemetrySink[];
  reconciler: MediaUploadQueueReconciler | null;
  staleSweepGracePeriodMs: number;
  delegates: NativeLegacyMediaDelegates;
  photoTranscoder: NativePhotoTranscoder | null;
  cleanupPreparedPhotoFiles: boolean;
  platform: "native" | "ios" | "android";
};

export function assertNativeUriSource(source: NativeLocalUriSource): void {
  if (!source || typeof source.uri !== "string") throw new Error("native_media_uri_required");
  const uri = source.uri.trim();
  if (!uri) throw new Error("native_media_uri_required");
  if (/^data:/i.test(uri)) {
    throw new Error("native_media_data_uri_forbidden");
  }
}

function sourceRefForNativeSource(source: NativeLocalUriSource): string {
  const uriParts = source.uri.split(/[/?#]/).filter(Boolean);
  const name = source.name?.trim() || uriParts[uriParts.length - 1] || "native-media";
  const mimeType = source.mimeType?.trim() || "application/octet-stream";
  const size = typeof source.sizeBytes === "number" && Number.isFinite(source.sizeBytes) ? source.sizeBytes : "unknown";
  return `${name}:${mimeType}:${size}`;
}

function scopeKeyForInput(input: NativeMediaUploadInput): string | null {
  return input.context?.scopeKey ?? null;
}

function sourceSha256ForInput(input: NativeMediaUploadInput): string | null {
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

function recordForSnapshot(input: NativeMediaUploadInput, snapshot: MediaUploadSnapshot): MediaUploadQueueRecord {
  const uploadContext = optionalStringRecordValue(input.context, "uploadContext");
  const matchId = optionalStringRecordValue(input.context, "matchId") ?? matchIdFromScopeKey(scopeKeyForInput(input));
  return {
    id: snapshot.id,
    clientRequestId: snapshot.clientRequestId,
    family: input.family,
    state: snapshot.state,
    sourceRef: sourceRefForNativeSource(input.source),
    sourceSha256: sourceSha256ForInput(input),
    scopeKey: scopeKeyForInput(input),
    createdAtMs: snapshot.createdAtMs,
    updatedAtMs: snapshot.updatedAtMs,
    snapshot,
    metadata: {
      adapter: "native",
      uri_scheme: input.source.uri.includes(":") ? input.source.uri.split(":")[0] : "path",
      source_uri: input.source.uri,
      mime_type: input.source.mimeType ?? null,
      upload_context: uploadContext,
      match_id: matchId,
    },
  };
}

function delegateForInput(input: NativeMediaUploadInput, delegates: NativeLegacyMediaDelegates | undefined) {
  switch (input.family) {
    case "vibe_video":
      return delegates?.video?.uploadVibeVideo as NativeMediaUploadDelegate | undefined;
    case "chat_vibe_clip":
      return delegates?.video?.uploadChatVibeClip as NativeMediaUploadDelegate | undefined;
    case "profile_photo":
      return delegates?.photo?.uploadProfilePhoto as NativeMediaUploadDelegate | undefined;
    case "chat_photo":
      return delegates?.photo?.uploadChatPhoto as NativeMediaUploadDelegate | undefined;
    case "event_cover":
      return delegates?.photo?.uploadEventCover as NativeMediaUploadDelegate | undefined;
    case "voice_note":
      return delegates?.voice?.uploadVoiceNote as NativeMediaUploadDelegate | undefined;
  }
}

function isPhotoUploadInput(input: NativeMediaUploadInput): input is NativePhotoUploadInput {
  return input.family === "profile_photo" || input.family === "chat_photo" || input.family === "event_cover";
}

async function inputWithPreparedPhotoSource(
  input: NativeMediaUploadInput,
  options: ResolvedNativeMediaSdkOptions,
): Promise<NativeMediaUploadInput> {
  if (!isPhotoUploadInput(input) || !options.photoTranscoder) return input;
  const preparedSource = await options.photoTranscoder(input.source, input, options.imageManipulator);
  assertNativeUriSource(preparedSource);
  if (preparedSource === input.source) return input;
  return { ...input, source: preparedSource };
}

async function cleanupPreparedNativePhotoSource(
  originalInput: NativeMediaUploadInput,
  preparedInput: NativeMediaUploadInput | null,
  options: ResolvedNativeMediaSdkOptions,
): Promise<void> {
  if (!options.cleanupPreparedPhotoFiles || !isPhotoUploadInput(originalInput) || !preparedInput) return;
  const preparedUri = preparedInput.source.uri;
  if (!preparedUri || preparedUri === originalInput.source.uri) return;
  await options.fileSystem?.deleteAsync?.(preparedUri, { idempotent: true }).catch(() => {});
}

export class NativeAsyncStorageMediaUploadQueue implements MediaUploadQueue {
  private readonly fallback = new MemoryMediaUploadQueue();
  private migrationPromise: Promise<void> | null = null;

  constructor(
    private readonly storage: NativeAsyncStorageLike | null | undefined,
    private readonly key = "vibely.upload-queue",
  ) {}

  private indexKey(): string {
    return `${this.key}:index`;
  }

  private recordKey(id: string): string {
    return `${this.key}:record:${id}`;
  }

  private async readLegacyAll(storage: NativeAsyncStorageLike): Promise<MediaUploadQueueRecord[]> {
    const raw = await storage.getItem(this.key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed as MediaUploadQueueRecord[] : [];
    } catch {
      return [];
    }
  }

  private async readIndex(storage: NativeAsyncStorageLike): Promise<string[]> {
    const raw = await storage.getItem(this.indexKey());
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && !!id) : [];
    } catch {
      return [];
    }
  }

  private async writeIndex(storage: NativeAsyncStorageLike, ids: readonly string[]): Promise<void> {
    await storage.setItem(this.indexKey(), JSON.stringify([...new Set(ids)]));
  }

  private async ensureMigrated(storage: NativeAsyncStorageLike): Promise<void> {
    if (this.migrationPromise) return this.migrationPromise;
    this.migrationPromise = (async () => {
      const legacy = await this.readLegacyAll(storage);
      if (!legacy.length) return;
      const ids = new Set(await this.readIndex(storage));
      for (const record of legacy) {
        await storage.setItem(this.recordKey(record.id), JSON.stringify(record));
        ids.add(record.id);
      }
      await this.writeIndex(storage, [...ids]);
      await storage.removeItem(this.key);
    })().catch(() => {
      this.migrationPromise = null;
    });
    return this.migrationPromise;
  }

  private async readStoredRecord(storage: NativeAsyncStorageLike, id: string): Promise<MediaUploadQueueRecord | null> {
    const raw = await storage.getItem(this.recordKey(id));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as MediaUploadQueueRecord;
      return parsed && parsed.id === id ? parsed : null;
    } catch {
      return null;
    }
  }

  async put(record: MediaUploadQueueRecord): Promise<void> {
    const storage = this.storage;
    if (!storage) return this.fallback.put(record);
    try {
      await this.ensureMigrated(storage);
      const ids = new Set(await this.readIndex(storage));
      ids.add(record.id);
      await storage.setItem(this.recordKey(record.id), JSON.stringify(record));
      await this.writeIndex(storage, [...ids]);
      await this.fallback.remove(record.id);
    } catch {
      await this.fallback.put(record);
    }
  }

  async get(id: string): Promise<MediaUploadQueueRecord | null> {
    const fallbackRecord = await this.fallback.get(id);
    if (fallbackRecord) return fallbackRecord;
    const storage = this.storage;
    if (!storage) return this.fallback.get(id);
    try {
      await this.ensureMigrated(storage);
      return (await this.readStoredRecord(storage, id)) ?? (await this.fallback.get(id));
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
    const storage = this.storage;
    if (!storage) return this.fallback.update(id, patch);
    try {
      await this.ensureMigrated(storage);
      const current = await this.readStoredRecord(storage, id);
      if (!current) return this.fallback.update(id, patch);
      const next = { ...current, ...patch, id };
      await storage.setItem(this.recordKey(id), JSON.stringify(next));
      await this.fallback.remove(id);
      return next;
    } catch {
      const current = await this.fallback.get(id);
      const next = current ? { ...current, ...patch, id } : null;
      if (!next) return null;
      await this.fallback.put(next);
      return next;
    }
  }

  async remove(id: string): Promise<void> {
    const storage = this.storage;
    if (!storage) return this.fallback.remove(id);
    try {
      await this.ensureMigrated(storage);
      await storage.removeItem(this.recordKey(id));
      await this.writeIndex(storage, (await this.readIndex(storage)).filter((recordId) => recordId !== id));
    } finally {
      await this.fallback.remove(id);
    }
  }

  async list(filter: MediaUploadQueueFilter = {}): Promise<MediaUploadQueueRecord[]> {
    const storage = this.storage;
    if (!storage) return this.fallback.list(filter);
    try {
      await this.ensureMigrated(storage);
      const rowsById = new Map<string, MediaUploadQueueRecord>();
      for (const id of await this.readIndex(storage)) {
        const row = await this.readStoredRecord(storage, id);
        if (row) rowsById.set(row.id, row);
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

async function validateNativeSource(
  input: NativeMediaUploadInput,
  fileSystem?: NativeFileSystemLike | null,
): Promise<void> {
  assertNativeUriSource(input.source);
  if (!fileSystem) return;
  const info = await fileSystem.getInfoAsync(input.source.uri);
  if (!info.exists || info.isDirectory) {
    throw new Error("native_media_file_missing");
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

function sourceFromNativeQueueRecord(record: MediaUploadQueueRecord): NativeLocalUriSource {
  const uri = typeof record.metadata?.source_uri === "string" && record.metadata.source_uri
    ? record.metadata.source_uri
    : record.sourceRef ?? "file:///rehydrated-media";
  return {
    uri,
    mimeType: typeof record.metadata?.mime_type === "string" ? record.metadata.mime_type : null,
  };
}

function inputFromNativeQueueRecord(record: MediaUploadQueueRecord): NativeMediaUploadInput {
  const uploadContext = optionalStringRecordValue(record.metadata, "upload_context")
    ?? (record.family === "chat_photo" || record.family === "voice_note" ? "chat" : profileContextFromScopeKey(record.scopeKey));
  const matchId = optionalStringRecordValue(record.metadata, "match_id") ?? matchIdFromScopeKey(record.scopeKey);
  return {
    family: record.family,
    source: sourceFromNativeQueueRecord(record),
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

function createNativeUploadTask(input: NativeMediaUploadInput, options: ResolvedNativeMediaSdkOptions): MediaUploadTask {
  const task = createMediaUploadTask({
    input,
    platform: options.platform,
    telemetry: options.telemetry,
    runner: async (controls) => {
      await validateNativeSource(input, options.fileSystem);
      const delegate = delegateForInput(input, options.delegates);
      if (!delegate) {
        controls.dispatch({
          type: "fail",
          error: {
            code: "media_delegate_missing",
            message: `No native media delegate registered for ${input.family}`,
            retryable: false,
          },
        });
        return;
      }

      let delegateInput: NativeMediaUploadInput | null = null;
      try {
        delegateInput = await inputWithPreparedPhotoSource(input, options);
        await delegate(delegateInput, controls);
      } finally {
        await cleanupPreparedNativePhotoSource(input, delegateInput, options);
      }
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

function rehydrateNativeUploadTask(record: MediaUploadQueueRecord, options: ResolvedNativeMediaSdkOptions): MediaUploadTask {
  const input = inputFromNativeQueueRecord(record);
  const task = createMediaUploadTask({
    id: record.id,
    initialSnapshot: record.snapshot,
    autoStart: false,
    input,
    platform: options.platform,
    telemetry: options.telemetry,
    runner: async (controls) => {
      await validateNativeSource(input, options.fileSystem);
      const delegate = delegateForInput(input, options.delegates);
      if (!delegate) {
        controls.dispatch({
          type: "fail",
          error: {
            code: "media_delegate_missing",
            message: `No native media delegate registered for ${input.family}`,
            retryable: false,
          },
        });
        return;
      }
      let delegateInput: NativeMediaUploadInput | null = null;
      try {
        delegateInput = await inputWithPreparedPhotoSource(input, options);
        await delegate(delegateInput, controls);
      } finally {
        await cleanupPreparedNativePhotoSource(input, delegateInput, options);
      }
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

function hasNativeRehydrateSource(record: MediaUploadQueueRecord): boolean {
  const uri = typeof record.metadata?.source_uri === "string" ? record.metadata.source_uri.trim() : "";
  return Boolean(uri && !/^data:/i.test(uri));
}

async function failMissingNativeRehydrateSource(options: ResolvedNativeMediaSdkOptions, record: MediaUploadQueueRecord): Promise<void> {
  const snapshot = transitionMediaUploadState(record.snapshot, {
    type: "fail",
    error: {
      code: "media_rehydrate_source_missing",
      message: "The original native upload source is no longer available.",
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
    fields: { adapter: "native" },
  });
}

async function resumeRecoverableNativeUploads(
  options: ResolvedNativeMediaSdkOptions,
  activeTaskIds: Set<string>,
): Promise<void> {
  const records = await options.queue.list({ states: RECOVERABLE_REHYDRATE_STATES });
  for (const record of records) {
    if (activeTaskIds.has(record.id)) continue;
    if (!hasNativeRehydrateSource(record)) {
      await failMissingNativeRehydrateSource(options, record);
      continue;
    }
    const task = rehydrateNativeUploadTask(record, options);
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

function withNativeDefaults(options: NativeMediaSdkOptions): ResolvedNativeMediaSdkOptions {
  const fileSystem = options.fileSystem ?? null;
  return {
    queue: options.queue ?? new NativeAsyncStorageMediaUploadQueue(options.asyncStorage),
    asyncStorage: options.asyncStorage ?? null,
    fileSystem,
    imageManipulator: options.imageManipulator ?? null,
    audio: options.audio ?? {},
    telemetry: options.telemetry ?? createMediaTelemetry(options.telemetrySinks),
    telemetrySinks: options.telemetrySinks ?? [],
    reconciler: options.reconciler ?? null,
    staleSweepGracePeriodMs: options.staleSweepGracePeriodMs ?? DEFAULT_MEDIA_UPLOAD_STALE_SWEEP_GRACE_MS,
    delegates: options.delegates ?? {},
    photoTranscoder: options.photoTranscoder === undefined
      ? (source, _input, imageManipulator) => nativeMediaTranscodeHooks.preparePhotoForUpload(source, {
          imageManipulator,
          fileSystem,
        })
      : options.photoTranscoder,
    cleanupPreparedPhotoFiles: options.photoTranscoder === undefined,
    platform: options.platform ?? "native",
  };
}

function emitNativeMediaSdkInitialized(telemetry: MediaTelemetry, platform: ResolvedNativeMediaSdkOptions["platform"]): void {
  try {
    telemetry.emit({
      name: "media_sdk_initialized",
      platform,
      fields: mediaBackgroundUploadPolicyTelemetryFields(),
    });
  } catch {
  }
}

export function createNativeMediaSdk(options: NativeMediaSdkOptions = {}): NativeMediaSdk {
  const resolved = withNativeDefaults(options);
  const activeRehydratedTaskIds = new Set<string>();
  emitNativeMediaSdkInitialized(resolved.telemetry, resolved.platform);
  return {
    video: {
      upload: (input) => createNativeUploadTask(input as NativeMediaUploadInput, resolved),
      rehydrate: (record) => rehydrateNativeUploadTask(record, resolved),
    },
    photo: {
      upload: (input) => createNativeUploadTask(input as NativeMediaUploadInput, resolved),
      rehydrate: (record) => rehydrateNativeUploadTask(record, resolved),
    },
    voice: {
      upload: (input) => createNativeUploadTask(input as NativeMediaUploadInput, resolved),
      rehydrate: (record) => rehydrateNativeUploadTask(record, resolved),
    },
    reconcile: async (options) => {
      const result = await reconcileMediaUploadQueue({
        queue: resolved.queue,
        reconciler: resolved.reconciler,
        telemetry: resolved.telemetry,
        staleSweepGracePeriodMs: resolved.staleSweepGracePeriodMs,
        reason: options?.reason,
      });
      if (options?.resume !== false) await resumeRecoverableNativeUploads(resolved, activeRehydratedTaskIds);
      return result;
    },
  };
}

function finitePositiveNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function nativePhotoFileName(source: NativeLocalUriSource): string {
  const uriName = source.uri.split(/[/?#]/).filter(Boolean).pop();
  const rawName = source.name?.trim() || uriName || "photo";
  return `${rawName.replace(/\.[^.]+$/, "") || "photo"}.jpg`;
}

function resizeActionsForNativePhoto(source: NativeLocalUriSource, maxEdge: number): readonly unknown[] {
  const width = finitePositiveNumber(source.width);
  const height = finitePositiveNumber(source.height);
  if (!width || !height || Math.max(width, height) <= maxEdge) return [];
  return width >= height
    ? [{ resize: { width: maxEdge } }]
    : [{ resize: { height: maxEdge } }];
}

function hasNativePhotoDimensions(source: NativeLocalUriSource): boolean {
  return finitePositiveNumber(source.width) !== null && finitePositiveNumber(source.height) !== null;
}

function isNativeImageManipulatorLike(value: unknown): value is NativeImageManipulatorLike {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as NativeImageManipulatorLike).manipulateAsync === "function",
  );
}

function isNativePhotoUploadInputLike(value: unknown): value is NativePhotoUploadInput {
  return Boolean(value && typeof value === "object" && "family" in value);
}

export const nativeMediaTranscodeHooks = {
  async preparePhotoForUpload(
    source: NativeLocalUriSource,
    inputOrOptions?: NativePhotoUploadInput | NativeImageManipulatorLike | {
      imageManipulator?: NativeImageManipulatorLike | null;
      fileSystem?: Pick<NativeFileSystemLike, "deleteAsync"> | null;
      maxEdge?: number;
      compress?: number;
      format?: string;
    } | null,
    imageManipulatorArg?: NativeImageManipulatorLike | null,
  ): Promise<NativeLocalUriSource> {
    assertNativeUriSource(source);
    const options: {
      imageManipulator?: NativeImageManipulatorLike | null;
      fileSystem?: Pick<NativeFileSystemLike, "deleteAsync"> | null;
      maxEdge?: number;
      compress?: number;
      format?: string;
    } =
      isNativeImageManipulatorLike(inputOrOptions) || isNativePhotoUploadInputLike(inputOrOptions)
        ? {}
        : inputOrOptions ?? {};
    const imageManipulator = isNativeImageManipulatorLike(inputOrOptions)
      ? inputOrOptions
      : isNativePhotoUploadInputLike(inputOrOptions)
        ? imageManipulatorArg
        : options.imageManipulator ?? imageManipulatorArg;
    if (!imageManipulator) return source;

    const maxEdge = options.maxEdge ?? 2048;
    const manipulationOptions = {
      compress: options.compress ?? 0.85,
      format: options.format ?? "jpeg",
    };
    const dimensionProbeOptions = {
      compress: 1,
      format: "png",
    };
    const actions = resizeActionsForNativePhoto(source, maxEdge);
    const cleanupProbeUri = async (uri: string | null | undefined): Promise<void> => {
      if (!uri || uri === source.uri) return;
      await options.fileSystem?.deleteAsync?.(uri, { idempotent: true }).catch(() => {});
    };
    const result = hasNativePhotoDimensions(source)
      ? await imageManipulator.manipulateAsync(source.uri, actions, manipulationOptions)
      : await (async () => {
          const probe = await imageManipulator.manipulateAsync(source.uri, [], dimensionProbeOptions);
          const followUpActions = resizeActionsForNativePhoto(probe, maxEdge);
          try {
            return await imageManipulator.manipulateAsync(source.uri, followUpActions, manipulationOptions);
          } finally {
            await cleanupProbeUri(probe.uri);
          }
        })();

    return {
      ...source,
      ...result,
      uri: result.uri,
      name: nativePhotoFileName(source),
      mimeType: "image/jpeg",
      sizeBytes: result.sizeBytes ?? source.sizeBytes ?? null,
      width: result.width ?? source.width ?? null,
      height: result.height ?? source.height ?? null,
    };
  },
  voiceRecordingOptions(audio?: NativeAudioHooks): Record<string, unknown> {
    return audio?.preferredVoiceRecordingOptions ?? {
      isMeteringEnabled: true,
      extension: ".m4a",
      sampleRate: 44100,
      numberOfChannels: 1,
      bitRate: 96000,
      android: {
        extension: ".m4a",
        outputFormat: "mpeg4",
        audioEncoder: "aac",
      },
      ios: {
        extension: ".m4a",
        outputFormat: "aac ",
        audioQuality: 0x60,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      web: {
        mimeType: "audio/webm",
        bitsPerSecond: 96000,
      },
    };
  },
  voiceRecordingCapabilities() {
    return {
      phase: "phase_5_voice_record_native",
      extension: ".m4a",
      sampleRate: 44100,
      numberOfChannels: 1,
      bitRate: 96000,
    };
  },
};
