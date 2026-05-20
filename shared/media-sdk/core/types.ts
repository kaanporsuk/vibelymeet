export type MediaUploadState =
  | "created"
  | "uploading"
  | "paused"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled";

export type MediaVideoFamily = "vibe_video" | "chat_vibe_clip";
export type MediaPhotoFamily = "profile_photo" | "chat_photo" | "event_cover";
export type MediaVoiceFamily = "voice_note";
export type MediaUploadFamily = MediaVideoFamily | MediaPhotoFamily | MediaVoiceFamily;

export type MediaUploadPlatform = "web" | "native" | "ios" | "android" | "unknown";

export type MediaUploadContext = {
  scopeKey?: string | null;
  uploadContext?: "onboarding" | "profile_studio" | "chat" | "event_cover" | string;
  [key: string]: unknown;
};

export type MediaUploadOptions = {
  clientRequestId?: string | null;
  sourceSha256?: string | null;
  expectedCurrentCoverAssetId?: string | null;
  signal?: AbortSignal | null;
  [key: string]: unknown;
};

export type MediaUploadInput<TSource = unknown> = {
  family: MediaUploadFamily;
  source: TSource;
  context?: MediaUploadContext | null;
  options?: MediaUploadOptions | null;
};

export type MediaVideoUploadInput<TSource = unknown> = MediaUploadInput<TSource> & {
  family: MediaVideoFamily;
};

export type MediaPhotoUploadInput<TSource = unknown> = MediaUploadInput<TSource> & {
  family: MediaPhotoFamily;
};

export type MediaVoiceUploadInput<TSource = unknown> = MediaUploadInput<TSource> & {
  family: MediaVoiceFamily;
};

export type MediaUploadResult = {
  assetId?: string | null;
  providerObjectId?: string | null;
  providerPath?: string | null;
  playbackUrl?: string | null;
  mediaRef?: string | null;
  contentSha256?: string | null;
  status?: string | null;
};

export type MediaUploadErrorInfo = {
  code: string;
  message?: string | null;
  retryable?: boolean;
};

export type MediaUploadSnapshot = {
  id: string;
  clientRequestId: string;
  family: MediaUploadFamily;
  platform: MediaUploadPlatform;
  state: MediaUploadState;
  progress: number;
  attempt: number;
  createdAtMs: number;
  updatedAtMs: number;
  error: MediaUploadErrorInfo | null;
  result: MediaUploadResult | null;
};

export type MediaUploadTaskEvent = "state" | "progress" | "error" | "telemetry";
export type MediaUploadTaskListener = (snapshot: MediaUploadSnapshot) => void;

export type MediaUploadTask = {
  readonly id: string;
  readonly clientRequestId: string;
  readonly family: MediaUploadFamily;
  on: (event: MediaUploadTaskEvent, cb: MediaUploadTaskListener) => () => void;
  applyServerSnapshot: (snapshot: {
    state: Extract<MediaUploadState, "uploading" | "processing" | "ready" | "failed" | "cancelled">;
    result?: MediaUploadResult | null;
    error?: MediaUploadErrorInfo | null;
    atMs?: number;
  }) => MediaUploadSnapshot;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: (reason?: string) => Promise<void>;
  retry: () => Promise<void>;
  snapshot: () => MediaUploadSnapshot;
};

export type MediaSdk = {
  video: {
    upload: <TSource>(input: MediaVideoUploadInput<TSource>) => MediaUploadTask;
    rehydrate: (record: import("./queue").MediaUploadQueueRecord) => MediaUploadTask;
  };
  photo: {
    upload: <TSource>(input: MediaPhotoUploadInput<TSource>) => MediaUploadTask;
    rehydrate: (record: import("./queue").MediaUploadQueueRecord) => MediaUploadTask;
  };
  voice: {
    upload: <TSource>(input: MediaVoiceUploadInput<TSource>) => MediaUploadTask;
    rehydrate: (record: import("./queue").MediaUploadQueueRecord) => MediaUploadTask;
  };
  reconcile: (options?: { reason?: string; resume?: boolean }) => Promise<import("./reconcile").MediaUploadReconcileResult>;
};
