/**
 * Native Daily call singleton for the Video Date screen (RN Daily adapter core).
 *
 * Invariants (incident-hardened — do not weaken):
 * - Park BEFORE any leave()/destroy: an active call is parked for warm handoff
 *   (`parkedAtMs` stamped, idle destroy disabled) before any cleanup path may
 *   run `leave()`/`destroy()`; destruction is allowed only on explicit active
 *   handoff cleanup (`mode: "destructive"`).
 * - Parked-call reuse is scoped to the same session/room only.
 * - `NATIVE_DAILY_CALL_SINGLETON_IDLE_MS = null` means idle destroy is fully
 *   disabled for live remount survival.
 *
 * Extracted verbatim from `app/date/[id].tsx` (VD rebuild PR 8); the two
 * module-scope `let`s became `nativeDailyCallSingletonState` properties so the
 * screen family can keep mutating them across files.
 */
import type { DailyParticipant } from "@daily-co/react-native-daily-js";
import { vdbg } from "@/lib/vdbg";
import { registerNativeVideoDateDailyCleanup } from "@/lib/nativeDailyCallInstance";
import type {
  NativeVideoDateCaptureProfile,
  VideoDateDailyCallObject,
} from "@/lib/videoDateDailyMediaConfig";
import type { PrejoinAttemptStep } from "@clientShared/matching/videoDatePrejoinAttempt";

export function readNativeDailyProviderSessionId(
  call: VideoDateDailyCallObject | null,
): string | null {
  if (!call) return null;
  try {
    const local = call.participants().local as
      | { session_id?: unknown; sessionId?: unknown }
      | undefined;
    const providerSessionId = local?.session_id ?? local?.sessionId;
    return typeof providerSessionId === "string" && providerSessionId.length > 0
      ? providerSessionId
      : null;
  } catch {
    return null;
  }
}

export function safeNativeDailyMeetingState(
  call: VideoDateDailyCallObject | null,
): string | null {
  if (!call || typeof call.meetingState !== "function") return null;
  try {
    const state = call.meetingState();
    return typeof state === "string"
      ? state
      : state == null
        ? null
        : String(state);
  } catch {
    return null;
  }
}

export const NATIVE_DAILY_CALL_SINGLETON_IDLE_MS: number | null = null;
export const NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS = 6;
export const NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_RETRY_BASE_MS = 300;

export type DailyCallObject = VideoDateDailyCallObject;
export type DailyReceiveSettingsCapable = {
  updateReceiveSettings?: (
    settings: Record<string, unknown>,
  ) => Promise<unknown>;
};
export type SharedDailyCallEntryState =
  | "creating"
  | "joining"
  | "joined"
  | "failed"
  | "leaving"
  | "idle";
export type SharedDailyCallEntry = {
  sessionId: string;
  userId: string;
  call: DailyCallObject;
  roomName: string | null;
  captureProfile: NativeVideoDateCaptureProfile;
  state: SharedDailyCallEntryState;
  joinPromise: Promise<void> | null;
  createdAtMs: number;
  joinStartedAtMs: number | null;
  lastError: string | null;
  idleDestroyTimer: ReturnType<typeof setTimeout> | null;
  parkedAtMs: number | null;
  idleDestroyDisabled: boolean;
};
export type NativeDailyCleanupOptions = {
  mode?: "destructive" | "preserve_active_handoff";
  reason?: string;
};
export type NativePrejoinPipelineEntry = {
  key: string;
  sessionId: string;
  userId: string;
  attemptId: number;
  startedAtMs: number;
  promise: Promise<void> | null;
};
export function nativePrejoinPipelineKey(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
}

export function summarizeSharedDailyError(error: unknown): string {
  if (error instanceof Error)
    return `${error.name || "Error"}: ${error.message}`;
  return String(error ?? "unknown");
}

export type PrejoinAttemptState = {
  attemptId: number;
  sessionId: string;
  userId: string;
  currentStep: PrejoinAttemptStep;
  cancellationReason: string | null;
  roomAcquisitionStarted: boolean;
  completed: boolean;
};

export type ActiveNativeDailyCallIdentity = {
  sessionId: string;
  userId: string;
  ownerId: string | null;
  callInstanceId: string;
  entryAttemptId: string | null;
  videoDateTraceId: string | null;
};

export function destroyNativeVideoDateDailyCall(
  call: DailyCallObject,
  reason: string,
  data?: Record<string, unknown>,
): Promise<void> {
  return registerNativeVideoDateDailyCleanup(
    Promise.resolve().then(async () => {
      await Promise.resolve(call.destroy());
    }),
    {
      source: "native_video_date_route",
      reason,
      onDiagnostic: (eventName, payload) => {
        vdbg(eventName, {
          reason,
          ...(data ?? {}),
          ...payload,
        });
      },
    },
  );
}

export const nativeDailyCallSingletonState: {
  sharedDailyCallEntry: SharedDailyCallEntry | null;
  sharedNativePrejoinPipelineEntry: NativePrejoinPipelineEntry | null;
} = {
  sharedDailyCallEntry: null,
  sharedNativePrejoinPipelineEntry: null,
};
