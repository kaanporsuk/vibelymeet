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
  };
  photo: {
    upload: (input: NativePhotoUploadInput) => MediaUploadTask;
  };
  voice: {
    upload: (input: NativeVoiceUploadInput) => MediaUploadTask;
  };
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
  flagGate?: MediaFeatureFlagGate;
  telemetry?: MediaTelemetry;
  telemetrySinks?: readonly MediaTelemetrySink[];
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
  flagGate: MediaFeatureFlagGate;
  telemetry: MediaTelemetry;
  telemetrySinks: readonly MediaTelemetrySink[];
  delegates: NativeLegacyMediaDelegates;
  photoTranscoder: NativePhotoTranscoder | null;
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

function recordForSnapshot(input: NativeMediaUploadInput, snapshot: MediaUploadSnapshot): MediaUploadQueueRecord {
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

export class NativeAsyncStorageMediaUploadQueue implements MediaUploadQueue {
  private readonly fallback = new MemoryMediaUploadQueue();

  constructor(
    private readonly storage: NativeAsyncStorageLike | null | undefined,
    private readonly key = "vibely.upload-queue",
  ) {}

  private async readAll(storage: NativeAsyncStorageLike): Promise<MediaUploadQueueRecord[]> {
    const raw = await storage.getItem(this.key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed as MediaUploadQueueRecord[] : [];
    } catch {
      return [];
    }
  }

  private async writeAll(storage: NativeAsyncStorageLike, records: readonly MediaUploadQueueRecord[]): Promise<void> {
    await storage.setItem(this.key, JSON.stringify(records));
  }

  async put(record: MediaUploadQueueRecord): Promise<void> {
    const storage = this.storage;
    if (!storage) return this.fallback.put(record);
    const records = (await this.readAll(storage)).filter((item) => item.id !== record.id);
    records.push(record);
    try {
      await this.writeAll(storage, records);
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
      return (await this.readAll(storage)).find((record) => record.id === id) ?? (await this.fallback.get(id));
    } catch {
      return this.fallback.get(id);
    }
  }

  async update(
    id: string,
    patch: Partial<Omit<MediaUploadQueueRecord, "id">>,
  ): Promise<MediaUploadQueueRecord | null> {
    const storage = this.storage;
    if (!storage) return this.fallback.update(id, patch);
    const records = await this.readAll(storage);
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) return this.fallback.update(id, patch);
    const next = { ...records[index], ...patch, id };
    records[index] = next;
    try {
      await this.writeAll(storage, records);
      await this.fallback.remove(id);
    } catch {
      await this.fallback.put(next);
    }
    return next;
  }

  async remove(id: string): Promise<void> {
    const storage = this.storage;
    if (!storage) return this.fallback.remove(id);
    try {
      await this.writeAll(storage, (await this.readAll(storage)).filter((record) => record.id !== id));
    } finally {
      await this.fallback.remove(id);
    }
  }

  async list(filter: MediaUploadQueueFilter = {}): Promise<MediaUploadQueueRecord[]> {
    const storage = this.storage;
    if (!storage) return this.fallback.list(filter);
    try {
      const rowsById = new Map<string, MediaUploadQueueRecord>();
      for (const row of await this.readAll(storage)) rowsById.set(row.id, row);
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

function createNativeUploadTask(input: NativeMediaUploadInput, options: ResolvedNativeMediaSdkOptions): MediaUploadTask {
  const task = createMediaUploadTask({
    input,
    platform: options.platform,
    telemetry: options.telemetry,
    runner: async (controls) => {
      await validateNativeSource(input, options.fileSystem);
      const flag = mediaFlagForFamily(input.family);
      const enabled = await options.flagGate.isEnabled(flag, input);
      controls.emitTelemetry("media_upload_sdk_flag_evaluated", {
        flag,
        enabled,
        adapter: "native",
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
            message: `No native media delegate registered for ${input.family}`,
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

function withNativeDefaults(options: NativeMediaSdkOptions): ResolvedNativeMediaSdkOptions {
  return {
    queue: options.queue ?? new NativeAsyncStorageMediaUploadQueue(options.asyncStorage),
    asyncStorage: options.asyncStorage ?? null,
    fileSystem: options.fileSystem ?? null,
    imageManipulator: options.imageManipulator ?? null,
    audio: options.audio ?? {},
    flagGate: options.flagGate ?? defaultOffMediaFeatureFlagGate,
    telemetry: options.telemetry ?? createMediaTelemetry(options.telemetrySinks),
    telemetrySinks: options.telemetrySinks ?? [],
    delegates: options.delegates ?? {},
    photoTranscoder: options.photoTranscoder === undefined
      ? (source, _input, imageManipulator) => nativeMediaTranscodeHooks.preparePhotoForUpload(source, imageManipulator)
      : options.photoTranscoder,
    platform: options.platform ?? "native",
  };
}

export function createNativeMediaSdk(options: NativeMediaSdkOptions = {}): NativeMediaSdk {
  const resolved = withNativeDefaults(options);
  return {
    video: {
      upload: (input) => createNativeUploadTask(input as NativeMediaUploadInput, resolved),
    },
    photo: {
      upload: (input) => createNativeUploadTask(input as NativeMediaUploadInput, resolved),
    },
    voice: {
      upload: (input) => createNativeUploadTask(input as NativeMediaUploadInput, resolved),
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

export const nativeMediaTranscodeHooks = {
  async preparePhotoForUpload(
    source: NativeLocalUriSource,
    imageManipulator?: NativeImageManipulatorLike | null,
    options: { maxEdge?: number; compress?: number; format?: string } = {},
  ): Promise<NativeLocalUriSource> {
    assertNativeUriSource(source);
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
    const result = hasNativePhotoDimensions(source)
      ? await imageManipulator.manipulateAsync(source.uri, actions, manipulationOptions)
      : await (async () => {
          const probe = await imageManipulator.manipulateAsync(source.uri, [], dimensionProbeOptions);
          const followUpActions = resizeActionsForNativePhoto(probe, maxEdge);
          return imageManipulator.manipulateAsync(source.uri, followUpActions, manipulationOptions);
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
