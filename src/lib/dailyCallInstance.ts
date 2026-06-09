import type { DailyCall, DailyFactoryOptions } from "@daily-co/daily-js";

type DailyCallFactory = {
  createCallObject: (options?: DailyFactoryOptions) => DailyCall;
  getCallInstance: () => DailyCall | null | undefined;
};

type DailyCallInstanceDiagnostic = (
  eventName: string,
  payload: Record<string, unknown>,
) => void;

export type GuardedDailyCreateFailureReason =
  | "cleanup_pending"
  | "external_call_busy"
  | "daily_create_failed";

export type GuardedDailyCreateResult =
  | {
      ok: true;
      call: DailyCall;
      destroyedExternalCall: boolean;
      recoveredDuplicate: boolean;
      adoptedExternalCall: boolean;
    }
  | {
      ok: false;
      reason: GuardedDailyCreateFailureReason;
      meetingState?: string | null;
      error?: unknown;
    };

type GuardedDailyCreateOptions = {
  source: string;
  currentCallObject?: DailyCall | null;
  skipIfCleanupPending?: boolean;
  waitForCleanup?: boolean;
  failOnExternalCall?: boolean;
  adoptMatchingExternalCall?: boolean;
  videoDateSessionId?: string | null;
  videoDateRoomName?: string | null;
  onDiagnostic?: DailyCallInstanceDiagnostic;
};

const FRESH_DAILY_CREATE_PROTECTION_MS = 10_000;
const WEB_VIDEO_DATE_DAILY_CLEANUP_WAIT_TIMEOUT_MS = 3_000;
const WEB_VIDEO_DATE_DAILY_DESTROY_TIMEOUT_MS = 2_500;
const DUPLICATE_DAILY_CALL_OBJECT_ERROR_PATTERNS = [
  /Duplicate\s+DailyIframe\s+instances/i,
  /multiple\s+call\s+instances/i,
  /call\s+object.*already/i,
  /already.*call\s+object/i,
  /only\s+one.*call/i,
  /single.*call\s+instance/i,
  /existing\s+call\s+instance/i,
];
const webVideoDateDailyCleanupPromises = new Set<Promise<void>>();
let webVideoDateDailyCreateQueue: Promise<void> = Promise.resolve();
let webVideoDateDailyCreateQueueDepth = 0;
let webVideoDateFreshCreatedCall: {
  call: DailyCall;
  createdAtMs: number;
  source: string;
  videoDateSessionId: string | null;
  videoDateRoomName: string | null;
} | null = null;

export function isDuplicateDailyCallObjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return DUPLICATE_DAILY_CALL_OBJECT_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

export function readDailyMeetingState(
  callObject: Pick<DailyCall, "meetingState">,
): string | null {
  try {
    const state = callObject.meetingState();
    return typeof state === "string" ? state : null;
  } catch {
    return "error";
  }
}

export function isTerminalDailyMeetingState(state: string | null): boolean {
  return state === "left-meeting" || state === "error";
}

export function isIdleDailyMeetingState(state: string | null): boolean {
  return (
    state === "new" || state === "loaded" || isTerminalDailyMeetingState(state)
  );
}

export function isBusyDailyMeetingState(state: string | null): boolean {
  return !isIdleDailyMeetingState(state);
}

export function isReusableDailyCallObject(callObject: DailyCall): boolean {
  try {
    if (callObject.isDestroyed()) return false;
  } catch {
    return false;
  }

  return readDailyMeetingState(callObject) === "joined-meeting";
}

export function hasWebVideoDateDailyCleanupPending(): boolean {
  return webVideoDateDailyCleanupPromises.size > 0;
}

function hasWebVideoDateDailyCreatePending(): boolean {
  return webVideoDateDailyCreateQueueDepth > 0;
}

async function serializeWebVideoDateDailyCreate<T>(
  source: string,
  onDiagnostic: DailyCallInstanceDiagnostic | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const previous = webVideoDateDailyCreateQueue;
  let releaseCurrentCreate: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrentCreate = resolve;
  });

  webVideoDateDailyCreateQueueDepth += 1;
  webVideoDateDailyCreateQueue = previous.then(
    () => current,
    () => current,
  );
  onDiagnostic?.("daily_guard_create_serialized", {
    source,
    queuedCount: Math.max(0, webVideoDateDailyCreateQueueDepth - 1),
  });

  try {
    await previous;
    return await task();
  } finally {
    webVideoDateDailyCreateQueueDepth = Math.max(
      0,
      webVideoDateDailyCreateQueueDepth - 1,
    );
    releaseCurrentCreate();
  }
}

function normalizeDailyCallMarker(
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function markFreshCreatedDailyCall(
  call: DailyCall,
  source: string,
  options?: Pick<
    GuardedDailyCreateOptions,
    "videoDateSessionId" | "videoDateRoomName"
  >,
) {
  webVideoDateFreshCreatedCall = {
    call,
    createdAtMs: Date.now(),
    source,
    videoDateSessionId: normalizeDailyCallMarker(options?.videoDateSessionId),
    videoDateRoomName: normalizeDailyCallMarker(options?.videoDateRoomName),
  };
}

function canAdoptProtectedFreshCreatedDailyCall(
  entry: NonNullable<typeof webVideoDateFreshCreatedCall>,
  options: GuardedDailyCreateOptions,
): boolean {
  if (options.adoptMatchingExternalCall !== true) return false;

  const requestedSessionId = normalizeDailyCallMarker(
    options.videoDateSessionId,
  );
  const requestedRoomName = normalizeDailyCallMarker(options.videoDateRoomName);
  if (!requestedSessionId || entry.videoDateSessionId !== requestedSessionId)
    return false;

  return (
    !requestedRoomName ||
    !entry.videoDateRoomName ||
    entry.videoDateRoomName === requestedRoomName
  );
}

function protectedFreshCreatedDailyCallDecision(
  callObject: DailyCall,
  meetingState: string | null,
  options: GuardedDailyCreateOptions,
): { protected: false } | { protected: true; adoptable: boolean } {
  const entry = webVideoDateFreshCreatedCall;
  if (!entry || entry.call !== callObject) return { protected: false };

  let isDestroyed = false;
  try {
    isDestroyed = callObject.isDestroyed();
  } catch {
    isDestroyed = true;
  }

  const ageMs = Math.max(0, Date.now() - entry.createdAtMs);
  if (
    isDestroyed ||
    isTerminalDailyMeetingState(meetingState) ||
    ageMs > FRESH_DAILY_CREATE_PROTECTION_MS
  ) {
    webVideoDateFreshCreatedCall = null;
    return { protected: false };
  }

  const adoptable = canAdoptProtectedFreshCreatedDailyCall(entry, options);
  options.onDiagnostic?.("daily_guard_external_call_protected_recent_create", {
    source: options.source,
    ownerSource: entry.source,
    meetingState,
    ageMs,
    adoptable,
    requestedVideoDateSessionId: normalizeDailyCallMarker(
      options.videoDateSessionId,
    ),
    ownerVideoDateSessionId: entry.videoDateSessionId,
    requestedVideoDateRoomName: normalizeDailyCallMarker(
      options.videoDateRoomName,
    ),
    ownerVideoDateRoomName: entry.videoDateRoomName,
  });
  return { protected: true, adoptable };
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; error: unknown }
  | { status: "timed_out" }
> {
  return new Promise((resolve) => {
    const timeout = setTimeout(
      () => resolve({ status: "timed_out" }),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve({ status: "fulfilled", value });
      },
      (error) => {
        clearTimeout(timeout);
        resolve({ status: "rejected", error });
      },
    );
  });
}

export function registerWebVideoDateDailyCleanup<T>(
  promise: Promise<T>,
  options?: {
    source?: string;
    reason?: string;
    onDiagnostic?: DailyCallInstanceDiagnostic;
  },
): Promise<T> {
  const tracked = Promise.resolve(promise)
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      webVideoDateDailyCleanupPromises.delete(tracked);
      options?.onDiagnostic?.("web_video_date_daily_cleanup_cleared", {
        source: options?.source ?? null,
        reason: options?.reason ?? null,
        pendingCount: webVideoDateDailyCleanupPromises.size,
      });
    });

  webVideoDateDailyCleanupPromises.add(tracked);
  options?.onDiagnostic?.("web_video_date_daily_cleanup_registered", {
    source: options?.source ?? null,
    reason: options?.reason ?? null,
    pendingCount: webVideoDateDailyCleanupPromises.size,
  });
  return promise;
}

export async function waitForWebVideoDateDailyCleanup(
  source: string,
  onDiagnostic?: DailyCallInstanceDiagnostic,
): Promise<boolean> {
  if (webVideoDateDailyCleanupPromises.size === 0) return false;

  onDiagnostic?.("web_video_date_daily_cleanup_awaited", {
    source,
    pendingCount: webVideoDateDailyCleanupPromises.size,
    timeoutMs: WEB_VIDEO_DATE_DAILY_CLEANUP_WAIT_TIMEOUT_MS,
  });
  while (webVideoDateDailyCleanupPromises.size > 0) {
    const pendingCount = webVideoDateDailyCleanupPromises.size;
    const result = await settleWithin(
      Promise.all(Array.from(webVideoDateDailyCleanupPromises)),
      WEB_VIDEO_DATE_DAILY_CLEANUP_WAIT_TIMEOUT_MS,
    );
    if (result.status === "timed_out") {
      onDiagnostic?.("web_video_date_daily_cleanup_wait_timed_out", {
        source,
        pendingCount,
        timeoutMs: WEB_VIDEO_DATE_DAILY_CLEANUP_WAIT_TIMEOUT_MS,
      });
      return true;
    }
  }
  return true;
}

function readSdkCallInstance(
  factory: DailyCallFactory,
  source: string,
  onDiagnostic?: DailyCallInstanceDiagnostic,
): DailyCall | null {
  try {
    return factory.getCallInstance() ?? null;
  } catch (error) {
    onDiagnostic?.("daily_get_call_instance_failed", {
      source,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
    });
    return null;
  }
}

async function destroyDailyCallObject(
  callObject: DailyCall,
  source: string,
  onDiagnostic?: DailyCallInstanceDiagnostic,
): Promise<boolean> {
  try {
    const result = await settleWithin(
      Promise.resolve(callObject.destroy()),
      WEB_VIDEO_DATE_DAILY_DESTROY_TIMEOUT_MS,
    );
    if (result.status === "timed_out") {
      onDiagnostic?.("daily_guard_destroy_external_call_timed_out", {
        source,
        timeoutMs: WEB_VIDEO_DATE_DAILY_DESTROY_TIMEOUT_MS,
      });
      return false;
    }
    if (result.status === "rejected") {
      throw result.error;
    }
    if (webVideoDateFreshCreatedCall?.call === callObject) {
      webVideoDateFreshCreatedCall = null;
    }
    onDiagnostic?.("daily_guard_destroyed_idle_external_call", { source });
    return true;
  } catch (error) {
    onDiagnostic?.("daily_guard_destroy_external_call_failed", {
      source,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
    });
    return false;
  }
}

async function clearExternalCallIfSafe(
  factory: DailyCallFactory,
  options: GuardedDailyCreateOptions,
): Promise<
  GuardedDailyCreateResult | { ok: true; destroyedExternalCall: boolean }
> {
  const sdkCallObject = readSdkCallInstance(
    factory,
    options.source,
    options.onDiagnostic,
  );
  if (!sdkCallObject) {
    return { ok: true, destroyedExternalCall: false };
  }

  const meetingState = readDailyMeetingState(sdkCallObject);
  options.onDiagnostic?.("daily_guard_external_call_found", {
    source: options.source,
    meetingState,
    isCurrentCallObject: sdkCallObject === options.currentCallObject,
    failOnExternalCall: options.failOnExternalCall === true,
    adoptMatchingExternalCall: options.adoptMatchingExternalCall === true,
    videoDateSessionId: normalizeDailyCallMarker(options.videoDateSessionId),
    videoDateRoomName: normalizeDailyCallMarker(options.videoDateRoomName),
  });

  if (
    sdkCallObject === options.currentCallObject &&
    !isTerminalDailyMeetingState(meetingState)
  ) {
    options.onDiagnostic?.("daily_guard_adopted_current_call_object", {
      source: options.source,
      meetingState,
      videoDateSessionId: normalizeDailyCallMarker(options.videoDateSessionId),
      videoDateRoomName: normalizeDailyCallMarker(options.videoDateRoomName),
    });
    return {
      ok: true,
      call: sdkCallObject,
      destroyedExternalCall: false,
      recoveredDuplicate: false,
      adoptedExternalCall: true,
    };
  }

  const protectedFreshCall = protectedFreshCreatedDailyCallDecision(
    sdkCallObject,
    meetingState,
    options,
  );
  if (protectedFreshCall.protected) {
    if (protectedFreshCall.adoptable) {
      options.onDiagnostic?.("daily_guard_adopted_same_session_external_call", {
        source: options.source,
        meetingState,
        videoDateSessionId: normalizeDailyCallMarker(
          options.videoDateSessionId,
        ),
        videoDateRoomName: normalizeDailyCallMarker(options.videoDateRoomName),
      });
      return {
        ok: true,
        call: sdkCallObject,
        destroyedExternalCall: false,
        recoveredDuplicate: false,
        adoptedExternalCall: true,
      };
    }
    return {
      ok: false,
      reason: "external_call_busy",
      meetingState,
    };
  }

  if (isBusyDailyMeetingState(meetingState)) {
    return {
      ok: false,
      reason: "external_call_busy",
      meetingState,
    };
  }

  if (
    options.failOnExternalCall &&
    !isTerminalDailyMeetingState(meetingState)
  ) {
    return {
      ok: false,
      reason: "external_call_busy",
      meetingState,
    };
  }

  const destroyed = await destroyDailyCallObject(
    sdkCallObject,
    options.source,
    options.onDiagnostic,
  );
  if (!destroyed) {
    return {
      ok: false,
      reason: "external_call_busy",
      meetingState,
    };
  }

  return { ok: true, destroyedExternalCall: true };
}

export async function createDailyCallObjectGuarded(
  factory: DailyCallFactory,
  factoryOptions: DailyFactoryOptions,
  options: GuardedDailyCreateOptions,
): Promise<GuardedDailyCreateResult> {
  if (options.skipIfCleanupPending && hasWebVideoDateDailyCreatePending()) {
    options.onDiagnostic?.("daily_guard_create_skipped_create_pending", {
      source: options.source,
    });
    return { ok: false, reason: "cleanup_pending" };
  }

  return serializeWebVideoDateDailyCreate(
    options.source,
    options.onDiagnostic,
    async () => {
      if (
        options.skipIfCleanupPending &&
        hasWebVideoDateDailyCleanupPending()
      ) {
        options.onDiagnostic?.("daily_guard_create_skipped_cleanup_pending", {
          source: options.source,
        });
        return { ok: false, reason: "cleanup_pending" };
      }

      if (options.waitForCleanup !== false) {
        await waitForWebVideoDateDailyCleanup(
          options.source,
          options.onDiagnostic,
        );
      }

      const beforeCreate = await clearExternalCallIfSafe(factory, options);
      if (beforeCreate.ok === false) return beforeCreate;
      if ("call" in beforeCreate) return beforeCreate;

      try {
        const call = factory.createCallObject(factoryOptions);
        markFreshCreatedDailyCall(call, options.source, options);
        return {
          ok: true,
          call,
          destroyedExternalCall: beforeCreate.destroyedExternalCall,
          recoveredDuplicate: false,
          adoptedExternalCall: false,
        };
      } catch (error) {
        if (!isDuplicateDailyCallObjectError(error)) {
          return { ok: false, reason: "daily_create_failed", error };
        }

        options.onDiagnostic?.(
          "daily_guard_recovered_duplicate_create_attempt",
          {
            source: options.source,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          },
        );

        const duplicateCleanup = await clearExternalCallIfSafe(
          factory,
          options,
        );
        if (duplicateCleanup.ok === false) return duplicateCleanup;
        if ("call" in duplicateCleanup) {
          return {
            ...duplicateCleanup,
            destroyedExternalCall:
              beforeCreate.destroyedExternalCall ||
              duplicateCleanup.destroyedExternalCall,
            recoveredDuplicate: true,
          };
        }

        try {
          const call = factory.createCallObject(factoryOptions);
          markFreshCreatedDailyCall(call, options.source, options);
          return {
            ok: true,
            call,
            destroyedExternalCall:
              beforeCreate.destroyedExternalCall ||
              duplicateCleanup.destroyedExternalCall,
            recoveredDuplicate: true,
            adoptedExternalCall: false,
          };
        } catch (retryError) {
          return {
            ok: false,
            reason: "daily_create_failed",
            error: retryError,
          };
        }
      }
    },
  );
}
