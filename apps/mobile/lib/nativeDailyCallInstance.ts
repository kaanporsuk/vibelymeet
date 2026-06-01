import Daily from '@daily-co/react-native-daily-js';

export type NativeDailyCallObject = ReturnType<typeof Daily.createCallObject>;
type NativeDailyCallOptions = NonNullable<Parameters<typeof Daily.createCallObject>[0]>;

type NativeDailyCallInstanceDiagnostic = (eventName: string, payload: Record<string, unknown>) => void;

export type GuardedNativeDailyCreateFailureReason =
  | 'cleanup_pending'
  | 'external_call_busy'
  | 'daily_create_failed';

export type GuardedNativeDailyCreateResult =
  | {
      ok: true;
      call: NativeDailyCallObject;
      destroyedExternalCall: boolean;
      recoveredDuplicate: boolean;
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
  onDiagnostic?: NativeDailyCallInstanceDiagnostic;
};

const FRESH_NATIVE_DAILY_CREATE_PROTECTION_MS = 10_000;
const nativeVideoDateDailyCleanupPromises = new Set<Promise<void>>();
let nativeVideoDateDailyCreateQueue: Promise<void> = Promise.resolve();
let nativeVideoDateDailyCreateQueueDepth = 0;
let nativeVideoDateFreshCreatedCall:
  | {
      call: NativeDailyCallObject;
      createdAtMs: number;
      source: string;
    }
  | null = null;

export function isDuplicateNativeDailyCallObjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Duplicate DailyIframe instances|multiple call instances/i.test(message);
}

export function readNativeDailyMeetingState(
  callObject: Pick<NativeDailyCallObject, 'meetingState'>,
): string | null {
  try {
    const state = callObject.meetingState();
    return typeof state === 'string' ? state : null;
  } catch {
    return 'error';
  }
}

export function isTerminalNativeDailyMeetingState(state: string | null): boolean {
  return state === 'left-meeting' || state === 'error';
}

export function isIdleNativeDailyMeetingState(state: string | null): boolean {
  return state === 'new' || state === 'loaded' || isTerminalNativeDailyMeetingState(state);
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
  nativeVideoDateDailyCreateQueue = previous.then(() => current, () => current);
  onDiagnostic?.('native_daily_guard_create_serialized', {
    source,
    queuedCount: Math.max(0, nativeVideoDateDailyCreateQueueDepth - 1),
  });

  try {
    await previous;
    return await task();
  } finally {
    nativeVideoDateDailyCreateQueueDepth = Math.max(0, nativeVideoDateDailyCreateQueueDepth - 1);
    releaseCurrentCreate();
  }
}

function markFreshCreatedNativeDailyCall(call: NativeDailyCallObject, source: string) {
  nativeVideoDateFreshCreatedCall = {
    call,
    createdAtMs: Date.now(),
    source,
  };
}

function isProtectedFreshCreatedNativeDailyCall(
  callObject: NativeDailyCallObject,
  meetingState: string | null,
  source: string,
  onDiagnostic?: NativeDailyCallInstanceDiagnostic,
): boolean {
  const entry = nativeVideoDateFreshCreatedCall;
  if (!entry || entry.call !== callObject) return false;

  let isDestroyed = false;
  try {
    isDestroyed = callObject.isDestroyed();
  } catch {
    isDestroyed = true;
  }

  const ageMs = Math.max(0, Date.now() - entry.createdAtMs);
  if (isDestroyed || isTerminalNativeDailyMeetingState(meetingState) || ageMs > FRESH_NATIVE_DAILY_CREATE_PROTECTION_MS) {
    nativeVideoDateFreshCreatedCall = null;
    return false;
  }

  onDiagnostic?.('native_daily_guard_external_call_protected_recent_create', {
    source,
    ownerSource: entry.source,
    meetingState,
    ageMs,
  });
  return true;
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
      options?.onDiagnostic?.('native_video_date_daily_cleanup_cleared', {
        source: options?.source ?? null,
        reason: options?.reason ?? null,
        pendingCount: nativeVideoDateDailyCleanupPromises.size,
      });
    });

  nativeVideoDateDailyCleanupPromises.add(tracked);
  options?.onDiagnostic?.('native_video_date_daily_cleanup_registered', {
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

  onDiagnostic?.('native_video_date_daily_cleanup_awaited', {
    source,
    pendingCount: nativeVideoDateDailyCleanupPromises.size,
  });
  while (nativeVideoDateDailyCleanupPromises.size > 0) {
    await Promise.all(Array.from(nativeVideoDateDailyCleanupPromises));
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
    onDiagnostic?.('native_daily_get_call_instance_failed', {
      source,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
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
    await Promise.resolve(callObject.destroy());
    onDiagnostic?.('native_daily_guard_destroyed_idle_external_call', { source });
    return true;
  } catch (error) {
    onDiagnostic?.('native_daily_guard_destroy_external_call_failed', {
      source,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });
    return false;
  }
}

async function clearNativeExternalCallIfSafe(
  options: GuardedNativeDailyCreateOptions,
): Promise<GuardedNativeDailyCreateResult | { ok: true; destroyedExternalCall: boolean }> {
  const sdkCallObject = readNativeSdkCallInstance(options.source, options.onDiagnostic);
  if (!sdkCallObject) {
    return { ok: true, destroyedExternalCall: false };
  }

  const meetingState = readNativeDailyMeetingState(sdkCallObject);
  options.onDiagnostic?.('native_daily_guard_external_call_found', {
    source: options.source,
    meetingState,
    isCurrentCallObject: sdkCallObject === options.currentCallObject,
    failOnExternalCall: options.failOnExternalCall === true,
  });

  if (
    isProtectedFreshCreatedNativeDailyCall(
      sdkCallObject,
      meetingState,
      options.source,
      options.onDiagnostic,
    )
  ) {
    return {
      ok: false,
      reason: 'external_call_busy',
      meetingState,
    };
  }

  if (options.failOnExternalCall || isBusyNativeDailyMeetingState(meetingState)) {
    return {
      ok: false,
      reason: 'external_call_busy',
      meetingState,
    };
  }

  const destroyed = await destroyNativeDailyCallObject(sdkCallObject, options.source, options.onDiagnostic);
  if (!destroyed) {
    return {
      ok: false,
      reason: 'external_call_busy',
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
    options.onDiagnostic?.('native_daily_guard_create_skipped_create_pending', { source: options.source });
    return { ok: false, reason: 'cleanup_pending' };
  }

  return serializeNativeVideoDateDailyCreate(options.source, options.onDiagnostic, async () => {
    if (options.skipIfCleanupPending && hasNativeVideoDateDailyCleanupPending()) {
      options.onDiagnostic?.('native_daily_guard_create_skipped_cleanup_pending', { source: options.source });
      return { ok: false, reason: 'cleanup_pending' };
    }

    if (options.waitForCleanup !== false) {
      await waitForNativeVideoDateDailyCleanup(options.source, options.onDiagnostic);
    }

    const beforeCreate = await clearNativeExternalCallIfSafe(options);
    if (beforeCreate.ok === false) return beforeCreate;

    try {
      const call = Daily.createCallObject(factoryOptions);
      markFreshCreatedNativeDailyCall(call, options.source);
      return {
        ok: true,
        call,
        destroyedExternalCall: beforeCreate.destroyedExternalCall,
        recoveredDuplicate: false,
      };
    } catch (error) {
      if (!isDuplicateNativeDailyCallObjectError(error)) {
        return { ok: false, reason: 'daily_create_failed', error };
      }

      options.onDiagnostic?.('native_daily_guard_recovered_duplicate_create_attempt', {
        source: options.source,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });

      const duplicateCleanup = await clearNativeExternalCallIfSafe(options);
      if (duplicateCleanup.ok === false) return duplicateCleanup;

      try {
        const call = Daily.createCallObject(factoryOptions);
        markFreshCreatedNativeDailyCall(call, options.source);
        return {
          ok: true,
          call,
          destroyedExternalCall: beforeCreate.destroyedExternalCall || duplicateCleanup.destroyedExternalCall,
          recoveredDuplicate: true,
        };
      } catch (retryError) {
        return { ok: false, reason: 'daily_create_failed', error: retryError };
      }
    }
  });
}
