import Daily from "@daily-co/react-native-daily-js";

export type NativeDailyCallObject = ReturnType<typeof Daily.createCallObject>;
type NativeDailyCallOptions = NonNullable<
  Parameters<typeof Daily.createCallObject>[0]
>;

type NativeDailyCallInstanceDiagnostic = (
  eventName: string,
  payload: Record<string, unknown>,
) => void;

export type GuardedNativeDailyCreateFailureReason =
  | "cleanup_pending"
  | "external_call_busy"
  | "daily_create_failed";

export type GuardedNativeDailyCreateResult =
  | {
      ok: true;
      call: NativeDailyCallObject;
      destroyedExternalCall: boolean;
      recoveredDuplicate: boolean;
      adoptedExternalCall: boolean;
    }
  | {
      ok: false;
      reason: GuardedNativeDailyCreateFailureReason;
      meetingState?: string | null;
      error?: unknown;
    };

type GuardedNativeDailyCreateOptions = {
  source: string;
  currentCallObject?: NativeDailyCallObject | null;
  skipIfCleanupPending?: boolean;
  waitForCleanup?: boolean;
  failOnExternalCall?: boolean;
  adoptMatchingExternalCall?: boolean;
  videoDateSessionId?: string | null;
  videoDateRoomName?: string | null;
  onDiagnostic?: NativeDailyCallInstanceDiagnostic;
};

const FRESH_NATIVE_DAILY_CREATE_PROTECTION_MS = 10_000;
const NATIVE_VIDEO_DATE_DAILY_CLEANUP_WAIT_TIMEOUT_MS = 3_000;
const NATIVE_VIDEO_DATE_DAILY_DESTROY_TIMEOUT_MS = 2_500;
const DUPLICATE_NATIVE_DAILY_CALL_OBJECT_ERROR_PATTERNS = [
  /Duplicate\s+DailyIframe\s+instances/i,
  /multiple\s+call\s+instances/i,
  /call\s+object.*already/i,
  /already.*call\s+object/i,
  /only\s+one.*call/i,
  /single.*call\s+instance/i,
  /existing\s+call\s+instance/i,
];
const nativeVideoDateDailyCleanupPromises = new Set<Promise<void>>();
let nativeVideoDateDailyCreateQueue: Promise<void> = Promise.resolve();
let nativeVideoDateDailyCreateQueueDepth = 0;
let nativeVideoDateFreshCreatedCall: {
  call: NativeDailyCallObject;
  createdAtMs: number;
  source: string;
  videoDateSessionId: string | null;
  videoDateRoomName: string | null;
} | null = null;

export function isDuplicateNativeDailyCallObjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return DUPLICATE_NATIVE_DAILY_CALL_OBJECT_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

export function readNativeDailyMeetingState(
  callObject: Pick<NativeDailyCallObject, "meetingState">,
): string | null {
  try {
    const state = callObject.meetingState();
    return typeof state === "string" ? state : null;
  } catch {
    return "error";
  }
}

export function isTerminalNativeDailyMeetingState(
  state: string | null,
): boolean {
  return state === "left-meeting" || state === "error";
}

export function isIdleNativeDailyMeetingState(state: string | null): boolean {
  return (
    state === "new" ||
    state === "loaded" ||
    isTerminalNativeDailyMeetingState(state)
  );
}

export function isBusyNativeDailyMeetingState(state: string | null): boolean {
  return !isIdleNativeDailyMeetingState(state);
}

export function hasNativeVideoDateDailyCleanupPending(): boolean {
  return nativeVideoDateDailyCleanupPromises.size > 0;
}

function hasNativeVideoDateDailyCreatePending(): boolean {
  return nativeVideoDateDailyCreateQueueDepth > 0;
}

async function serializeNativeVideoDateDailyCreate<T>(
  source: string,
  onDiagnostic: NativeDailyCallInstanceDiagnostic | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const previous = nativeVideoDateDailyCreateQueue;
  let releaseCurrentCreate: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrentCreate = resolve;
  });

  nativeVideoDateDailyCreateQueueDepth += 1;
  nativeVideoDateDailyCreateQueue = previous.then(
    () => current,
    () => current,
  );
  onDiagnostic?.("native_daily_guard_create_serialized", {
    source,
    queuedCount: Math.max(0, nativeVideoDateDailyCreateQueueDepth - 1),
  });

  try {
    await previous;
    return await task();
  } finally {
    nativeVideoDateDailyCreateQueueDepth = Math.max(
      0,
      nativeVideoDateDailyCreateQueueDepth - 1,
    );
    releaseCurrentCreate();
  }
}

function normalizeNativeDailyCallMarker(
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function markFreshCreatedNativeDailyCall(
  call: NativeDailyCallObject,
  source: string,
  options?: Pick<
    GuardedNativeDailyCreateOptions,
    "videoDateSessionId" | "videoDateRoomName"
  >,
) {
  nativeVideoDateFreshCreatedCall = {
    call,
    createdAtMs: Date.now(),
    source,
    videoDateSessionId: normalizeNativeDailyCallMarker(
      options?.videoDateSessionId,
    ),
    videoDateRoomName: normalizeNativeDailyCallMarker(
      options?.videoDateRoomName,
    ),
  };
}

function canAdoptProtectedFreshCreatedNativeDailyCall(
  entry: NonNullable<typeof nativeVideoDateFreshCreatedCall>,
  options: GuardedNativeDailyCreateOptions,
): boolean {
  if (options.adoptMatchingExternalCall !== true) return false;

  const requestedSessionId = normalizeNativeDailyCallMarker(
    options.videoDateSessionId,
  );
  const requestedRoomName = normalizeNativeDailyCallMarker(
    options.videoDateRoomName,
  );
  if (!requestedSessionId || entry.videoDateSessionId !== requestedSessionId)
    return false;

  return (
    !requestedRoomName ||
    !entry.videoDateRoomName ||
    entry.videoDateRoomName === requestedRoomName
  );
}

function protectedFreshCreatedNativeDailyCallDecision(
  callObject: NativeDailyCallObject,
  meetingState: string | null,
  options: GuardedNativeDailyCreateOptions,
): { protected: false } | { protected: true; adoptable: boolean } {
  const entry = nativeVideoDateFreshCreatedCall;
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
    isTerminalNativeDailyMeetingState(meetingState) ||
    ageMs > FRESH_NATIVE_DAILY_CREATE_PROTECTION_MS
  ) {
    nativeVideoDateFreshCreatedCall = null;
    return { protected: false };
  }

  const adoptable = canAdoptProtectedFreshCreatedNativeDailyCall(
    entry,
    options,
  );
  options.onDiagnostic?.(
    "native_daily_guard_external_call_protected_recent_create",
    {
      source: options.source,
      ownerSource: entry.source,
      meetingState,
      ageMs,
      adoptable,
      requestedVideoDateSessionId: normalizeNativeDailyCallMarker(
        options.videoDateSessionId,
      ),
      ownerVideoDateSessionId: entry.videoDateSessionId,
      requestedVideoDateRoomName: normalizeNativeDailyCallMarker(
        options.videoDateRoomName,
      ),
      ownerVideoDateRoomName: entry.videoDateRoomName,
    },
  );
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

export function registerNativeVideoDateDailyCleanup<T>(
  promise: Promise<T>,
  options?: {
    source?: string;
    reason?: string;
    onDiagnostic?: NativeDailyCallInstanceDiagnostic;
  },
): Promise<T> {
  const tracked = Promise.resolve(promise)
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      nativeVideoDateDailyCleanupPromises.delete(tracked);
      options?.onDiagnostic?.("native_video_date_daily_cleanup_cleared", {
        source: options?.source ?? null,
        reason: options?.reason ?? null,
        pendingCount: nativeVideoDateDailyCleanupPromises.size,
      });
    });

  nativeVideoDateDailyCleanupPromises.add(tracked);
  options?.onDiagnostic?.("native_video_date_daily_cleanup_registered", {
    source: options?.source ?? null,
    reason: options?.reason ?? null,
    pendingCount: nativeVideoDateDailyCleanupPromises.size,
  });
  return promise;
}

export async function waitForNativeVideoDateDailyCleanup(
  source: string,
  onDiagnostic?: NativeDailyCallInstanceDiagnostic,
): Promise<boolean> {
  if (nativeVideoDateDailyCleanupPromises.size === 0) return false;

  onDiagnostic?.("native_video_date_daily_cleanup_awaited", {
    source,
    pendingCount: nativeVideoDateDailyCleanupPromises.size,
    timeoutMs: NATIVE_VIDEO_DATE_DAILY_CLEANUP_WAIT_TIMEOUT_MS,
  });
  while (nativeVideoDateDailyCleanupPromises.size > 0) {
    const pendingCount = nativeVideoDateDailyCleanupPromises.size;
    const result = await settleWithin(
      Promise.all(Array.from(nativeVideoDateDailyCleanupPromises)),
      NATIVE_VIDEO_DATE_DAILY_CLEANUP_WAIT_TIMEOUT_MS,
    );
    if (result.status === "timed_out") {
      onDiagnostic?.("native_video_date_daily_cleanup_wait_timed_out", {
        source,
        pendingCount,
        timeoutMs: NATIVE_VIDEO_DATE_DAILY_CLEANUP_WAIT_TIMEOUT_MS,
      });
      return true;
    }
  }
  return true;
}

function readNativeSdkCallInstance(
  source: string,
  onDiagnostic?: NativeDailyCallInstanceDiagnostic,
): NativeDailyCallObject | null {
  try {
    return Daily.getCallInstance() ?? null;
  } catch (error) {
    onDiagnostic?.("native_daily_get_call_instance_failed", {
      source,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
    });
    return null;
  }
}

async function destroyNativeDailyCallObject(
  callObject: NativeDailyCallObject,
  source: string,
  onDiagnostic?: NativeDailyCallInstanceDiagnostic,
): Promise<boolean> {
  try {
    const result = await settleWithin(
      Promise.resolve(callObject.destroy()),
      NATIVE_VIDEO_DATE_DAILY_DESTROY_TIMEOUT_MS,
    );
    if (result.status === "timed_out") {
      onDiagnostic?.("native_daily_guard_destroy_external_call_timed_out", {
        source,
        timeoutMs: NATIVE_VIDEO_DATE_DAILY_DESTROY_TIMEOUT_MS,
      });
      return false;
    }
    if (result.status === "rejected") {
      throw result.error;
    }
    if (nativeVideoDateFreshCreatedCall?.call === callObject) {
      nativeVideoDateFreshCreatedCall = null;
    }
    onDiagnostic?.("native_daily_guard_destroyed_idle_external_call", {
      source,
    });
    return true;
  } catch (error) {
    onDiagnostic?.("native_daily_guard_destroy_external_call_failed", {
      source,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
    });
    return false;
  }
}

async function clearNativeExternalCallIfSafe(
  options: GuardedNativeDailyCreateOptions,
): Promise<
  GuardedNativeDailyCreateResult | { ok: true; destroyedExternalCall: boolean }
> {
  const sdkCallObject = readNativeSdkCallInstance(
    options.source,
    options.onDiagnostic,
  );
  if (!sdkCallObject) {
    return { ok: true, destroyedExternalCall: false };
  }

  const meetingState = readNativeDailyMeetingState(sdkCallObject);
  options.onDiagnostic?.("native_daily_guard_external_call_found", {
    source: options.source,
    meetingState,
    isCurrentCallObject: sdkCallObject === options.currentCallObject,
    failOnExternalCall: options.failOnExternalCall === true,
    adoptMatchingExternalCall: options.adoptMatchingExternalCall === true,
    videoDateSessionId: normalizeNativeDailyCallMarker(
      options.videoDateSessionId,
    ),
    videoDateRoomName: normalizeNativeDailyCallMarker(
      options.videoDateRoomName,
    ),
  });

  if (
    sdkCallObject === options.currentCallObject &&
    !isTerminalNativeDailyMeetingState(meetingState)
  ) {
    options.onDiagnostic?.("native_daily_guard_adopted_current_call_object", {
      source: options.source,
      meetingState,
      videoDateSessionId: normalizeNativeDailyCallMarker(
        options.videoDateSessionId,
      ),
      videoDateRoomName: normalizeNativeDailyCallMarker(
        options.videoDateRoomName,
      ),
    });
    return {
      ok: true,
      call: sdkCallObject,
      destroyedExternalCall: false,
      recoveredDuplicate: false,
      adoptedExternalCall: true,
    };
  }

  const protectedFreshCall = protectedFreshCreatedNativeDailyCallDecision(
    sdkCallObject,
    meetingState,
    options,
  );
  if (protectedFreshCall.protected) {
    if (protectedFreshCall.adoptable) {
      options.onDiagnostic?.(
        "native_daily_guard_adopted_same_session_external_call",
        {
          source: options.source,
          meetingState,
          videoDateSessionId: normalizeNativeDailyCallMarker(
            options.videoDateSessionId,
          ),
          videoDateRoomName: normalizeNativeDailyCallMarker(
            options.videoDateRoomName,
          ),
        },
      );
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

  if (isBusyNativeDailyMeetingState(meetingState)) {
    return {
      ok: false,
      reason: "external_call_busy",
      meetingState,
    };
  }

  if (
    options.failOnExternalCall &&
    !isTerminalNativeDailyMeetingState(meetingState)
  ) {
    return {
      ok: false,
      reason: "external_call_busy",
      meetingState,
    };
  }

  const destroyed = await destroyNativeDailyCallObject(
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

export async function createNativeDailyCallObjectGuarded(
  factoryOptions: NativeDailyCallOptions,
  options: GuardedNativeDailyCreateOptions,
): Promise<GuardedNativeDailyCreateResult> {
  if (options.skipIfCleanupPending && hasNativeVideoDateDailyCreatePending()) {
    options.onDiagnostic?.("native_daily_guard_create_skipped_create_pending", {
      source: options.source,
    });
    return { ok: false, reason: "cleanup_pending" };
  }

  return serializeNativeVideoDateDailyCreate(
    options.source,
    options.onDiagnostic,
    async () => {
      if (
        options.skipIfCleanupPending &&
        hasNativeVideoDateDailyCleanupPending()
      ) {
        options.onDiagnostic?.(
          "native_daily_guard_create_skipped_cleanup_pending",
          { source: options.source },
        );
        return { ok: false, reason: "cleanup_pending" };
      }

      if (options.waitForCleanup !== false) {
        await waitForNativeVideoDateDailyCleanup(
          options.source,
          options.onDiagnostic,
        );
      }

      const beforeCreate = await clearNativeExternalCallIfSafe(options);
      if (beforeCreate.ok === false) return beforeCreate;
      if ("call" in beforeCreate) return beforeCreate;

      try {
        const call = Daily.createCallObject(factoryOptions);
        markFreshCreatedNativeDailyCall(call, options.source, options);
        return {
          ok: true,
          call,
          destroyedExternalCall: beforeCreate.destroyedExternalCall,
          recoveredDuplicate: false,
          adoptedExternalCall: false,
        };
      } catch (error) {
        if (!isDuplicateNativeDailyCallObjectError(error)) {
          return { ok: false, reason: "daily_create_failed", error };
        }

        options.onDiagnostic?.(
          "native_daily_guard_recovered_duplicate_create_attempt",
          {
            source: options.source,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          },
        );

        const duplicateCleanup = await clearNativeExternalCallIfSafe(options);
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
          const call = Daily.createCallObject(factoryOptions);
          markFreshCreatedNativeDailyCall(call, options.source, options);
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
