import { resolveReadyGateTerminalRecovery } from "./readyGateTerminalRecovery";

export type ReadyGateDiagnosticKey =
  | "camera_permission"
  | "microphone_permission"
  | "camera_device"
  | "microphone_device"
  | "video_provider"
  | "realtime_sync"
  | "partner_readiness";

export type ReadyGateDiagnosticStatus =
  | "ok"
  | "checking"
  | "waiting"
  | "blocked"
  | "failed"
  | "warning"
  | "unknown";

export type ReadyGateDiagnosticSeverity = "success" | "info" | "warning" | "error";

export type ReadyGateDiagnosticActionKind =
  | "none"
  | "request_permission"
  | "open_settings"
  | "retry"
  | "check_connection"
  | "wait";

export type ReadyGatePlatform = "web" | "native";

export type ReadyGateDiagnosticCopy = {
  key: ReadyGateDiagnosticKey;
  status: ReadyGateDiagnosticStatus;
  severity: ReadyGateDiagnosticSeverity;
  label: string;
  title: string;
  message: string;
  actionLabel: string | null;
  actionKind: ReadyGateDiagnosticActionKind;
};

export type ReadyGatePrepareEntryFailureCopy = {
  code: string | null;
  title: string;
  message: string;
  retryable: boolean;
  terminal: boolean;
};

export type ReadyGateTransitionFailureAction = "mark_ready" | "snooze" | "forfeit";

export type ReadyGateTransitionFailureCopy = {
  action: ReadyGateTransitionFailureAction;
  code: string | null;
  reasonCode: string;
  title: string;
  message: string;
  retryable: boolean;
  staleOrConflict: boolean;
};

export type ReadyGateDiagnosticChecklistInput = {
  platform?: ReadyGatePlatform;
  partnerName?: string | null;
  cameraPermissionStatus?: ReadyGateDiagnosticStatus | null;
  microphonePermissionStatus?: ReadyGateDiagnosticStatus | null;
  cameraDeviceStatus?: ReadyGateDiagnosticStatus | null;
  microphoneDeviceStatus?: ReadyGateDiagnosticStatus | null;
  videoProviderStatus?: ReadyGateDiagnosticStatus | null;
  realtimeSyncStatus?: ReadyGateDiagnosticStatus | null;
  partnerReadinessStatus?: ReadyGateDiagnosticStatus | null;
};

export type ReadyGateDiagnosticChecklist = {
  rows: ReadyGateDiagnosticCopy[];
  primaryIssue: ReadyGateDiagnosticCopy | null;
  canProceed: boolean;
};

const DIAGNOSTIC_LABELS: Record<ReadyGateDiagnosticKey, string> = {
  camera_permission: "Camera permission",
  microphone_permission: "Microphone permission",
  camera_device: "Camera",
  microphone_device: "Microphone",
  video_provider: "Video setup",
  realtime_sync: "Status sync",
  partner_readiness: "Match readiness",
};

const READY_GATE_TRANSITION_STALE_OR_CONFLICT_SIGNALS = new Set([
  "surface_claim_conflict",
  "stale_transition",
  "guarded_update_zero_rows",
  "session_no_longer_ready_gate_mutable",
  "session_missing",
  "session_ended",
  "session_not_ready_gate_eligible",
  "ready_gate_not_ready",
  "event_not_active",
  "expired",
  "forfeited",
  "terminal",
  "conflict",
  "not_session_participant",
]);

function normalizeCode(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSignal(value: string | null | undefined): string | null {
  const code = normalizeCode(value);
  return code ? code.toLowerCase() : null;
}

function defaultReadyGateTransitionFailureCopy(action: ReadyGateTransitionFailureAction): {
  title: string;
  message: string;
  reasonCode: string;
} {
  switch (action) {
    case "mark_ready":
      return {
        title: "Could not mark you ready",
        message: "We couldn't mark you ready. Check your connection and try again.",
        reasonCode: "ready_gate_mark_ready_failed",
      };
    case "snooze":
      return {
        title: "Could not snooze",
        message: "We couldn't snooze this match. Check your connection and try again.",
        reasonCode: "ready_gate_snooze_failed",
      };
    case "forfeit":
      return {
        title: "Could not step away",
        message: "We couldn't step away. Check your connection and try again.",
        reasonCode: "ready_gate_forfeit_failed",
      };
  }
}

export function resolveReadyGateTransitionFailureCopy(input: {
  action: ReadyGateTransitionFailureAction;
  code?: string | null;
  errorCode?: string | null;
  reason?: string | null;
  error?: string | null;
  status?: string | null;
  platform?: ReadyGatePlatform;
}): ReadyGateTransitionFailureCopy {
  const primaryCode = normalizeCode(input.code) ?? normalizeCode(input.errorCode) ?? null;
  const signals = [
    input.code,
    input.errorCode,
    input.reason,
    input.error,
    input.status,
  ]
    .map(normalizeSignal)
    .filter((value): value is string => Boolean(value));
  const staleOrConflict = signals.some((signal) => READY_GATE_TRANSITION_STALE_OR_CONFLICT_SIGNALS.has(signal));

  if (staleOrConflict) {
    const surface = input.platform === "native" ? "device" : "device or tab";
    return {
      action: input.action,
      code: primaryCode,
      reasonCode: "ready_gate_transition_conflict",
      title: "Ready Gate changed",
      message: `Another ${surface} already changed this Ready Gate. We are syncing the latest state.`,
      retryable: true,
      staleOrConflict: true,
    };
  }

  const fallback = defaultReadyGateTransitionFailureCopy(input.action);
  return {
    action: input.action,
    code: primaryCode,
    reasonCode: fallback.reasonCode,
    title: fallback.title,
    message: fallback.message,
    retryable: true,
    staleOrConflict: false,
  };
}

function severityForStatus(status: ReadyGateDiagnosticStatus): ReadyGateDiagnosticSeverity {
  if (status === "ok") return "success";
  if (status === "blocked" || status === "failed") return "error";
  if (status === "warning") return "warning";
  // "checking", "waiting", "unknown" are all informational, non-blocking states.
  return "info";
}

function normalizeDiagnosticStatus(
  status: ReadyGateDiagnosticStatus | null | undefined,
  fallback: ReadyGateDiagnosticStatus,
): ReadyGateDiagnosticStatus {
  return status ?? fallback;
}

export function resolveReadyGateDiagnosticCopy(input: {
  key: ReadyGateDiagnosticKey;
  status: ReadyGateDiagnosticStatus;
  platform?: ReadyGatePlatform;
  partnerName?: string | null;
}): ReadyGateDiagnosticCopy {
  const label = DIAGNOSTIC_LABELS[input.key];
  const partnerLabel = input.partnerName || "your match";
  const severity = severityForStatus(input.status);
  const base = {
    key: input.key,
    status: input.status,
    severity,
    label,
  };

  if (input.status === "ok") {
    return {
      ...base,
      title: `${label} ready`,
      message: `${label} is ready for this date.`,
      actionLabel: null,
      actionKind: "none",
    };
  }

  if (input.status === "waiting") {
    // Neutral, pre-start state: nothing is being checked yet. Used for the
    // video provider row before the prepare-entry handoff actually begins, so
    // the UI does not falsely claim a "check in progress" when no check exists.
    if (input.key === "video_provider") {
      return {
        ...base,
        title: "Video setup waiting",
        message: "We'll verify the video room when both people are ready.",
        actionLabel: null,
        actionKind: "wait",
      };
    }
    return {
      ...base,
      title: `${label} waiting`,
      message: "We'll check this when both people are ready.",
      actionLabel: null,
      actionKind: "wait",
    };
  }

  if (input.status === "checking" || input.status === "unknown") {
    return {
      ...base,
      title: `${label} check in progress`,
      message: "We are checking this before the date starts.",
      actionLabel: null,
      actionKind: "wait",
    };
  }

  switch (input.key) {
    case "camera_permission":
      if (input.status === "warning") {
        return {
          ...base,
          title: "Camera access is not enabled yet",
          message:
            input.platform === "native"
              ? "Tap Allow when you are ready so the phone can show the camera prompt."
              : "Allow camera access in your browser when you are ready.",
          actionLabel: "Allow camera",
          actionKind: "request_permission",
        };
      }
      return {
        ...base,
        title: "Camera access is needed",
        message:
          input.platform === "native"
            ? "Allow camera access in your phone settings, then try again."
            : "Allow camera access in your browser, then try again.",
        actionLabel: input.platform === "native" ? "Open settings" : "Enable camera",
        actionKind: input.platform === "native" ? "open_settings" : "request_permission",
      };
    case "microphone_permission":
      if (input.status === "warning") {
        return {
          ...base,
          title: "Microphone access is not enabled yet",
          message:
            input.platform === "native"
              ? "Tap Allow when you are ready so the phone can show the microphone prompt."
              : "Allow microphone access in your browser when you are ready.",
          actionLabel: "Allow microphone",
          actionKind: "request_permission",
        };
      }
      return {
        ...base,
        title: "Microphone access is needed",
        message:
          input.platform === "native"
            ? "Allow microphone access in your phone settings, then try again."
            : "Allow microphone access in your browser, then try again.",
        actionLabel: input.platform === "native" ? "Open settings" : "Enable microphone",
        actionKind: input.platform === "native" ? "open_settings" : "request_permission",
      };
    case "camera_device":
      return {
        ...base,
        title: "No camera was found",
        message: "Connect or enable a camera before joining this date.",
        actionLabel: "Check again",
        actionKind: "retry",
      };
    case "microphone_device":
      return {
        ...base,
        title: "No microphone was found",
        message: "Connect or enable a microphone before joining this date.",
        actionLabel: "Check again",
        actionKind: "retry",
      };
    case "video_provider":
      return {
        ...base,
        title: "Video setup needs a retry",
        message: "The video room could not be verified yet. Try again in a moment.",
        actionLabel: "Retry video setup",
        actionKind: "retry",
      };
    case "realtime_sync":
      return {
        ...base,
        title: "Status sync is delayed",
        message: "Keep this screen open while we reconnect your Ready Gate status.",
        actionLabel: "Retry sync",
        actionKind: "check_connection",
      };
    case "partner_readiness":
      return {
        ...base,
        title: "Waiting for your match",
        message: `${partnerLabel} is not ready yet. We will connect you when both of you are ready.`,
        actionLabel: null,
        actionKind: "wait",
      };
  }
}

export function resolveReadyGateDiagnosticChecklist(
  input: ReadyGateDiagnosticChecklistInput,
): ReadyGateDiagnosticChecklist {
  const platform = input.platform ?? "web";
  const partnerName = input.partnerName ?? null;
  const rows = [
    resolveReadyGateDiagnosticCopy({
      key: "camera_permission",
      status: normalizeDiagnosticStatus(input.cameraPermissionStatus, "unknown"),
      platform,
      partnerName,
    }),
    resolveReadyGateDiagnosticCopy({
      key: "microphone_permission",
      status: normalizeDiagnosticStatus(input.microphonePermissionStatus, "unknown"),
      platform,
      partnerName,
    }),
    resolveReadyGateDiagnosticCopy({
      key: "camera_device",
      status: normalizeDiagnosticStatus(input.cameraDeviceStatus, "unknown"),
      platform,
      partnerName,
    }),
    resolveReadyGateDiagnosticCopy({
      key: "microphone_device",
      status: normalizeDiagnosticStatus(input.microphoneDeviceStatus, "unknown"),
      platform,
      partnerName,
    }),
    resolveReadyGateDiagnosticCopy({
      key: "video_provider",
      status: normalizeDiagnosticStatus(input.videoProviderStatus, "checking"),
      platform,
      partnerName,
    }),
    resolveReadyGateDiagnosticCopy({
      key: "realtime_sync",
      status: normalizeDiagnosticStatus(input.realtimeSyncStatus, "checking"),
      platform,
      partnerName,
    }),
    resolveReadyGateDiagnosticCopy({
      key: "partner_readiness",
      status: normalizeDiagnosticStatus(input.partnerReadinessStatus, "checking"),
      platform,
      partnerName,
    }),
  ];
  const primaryIssue =
    rows.find((row) => row.severity === "error") ??
    rows.find((row) => row.severity === "warning") ??
    null;
  return {
    rows,
    primaryIssue,
    canProceed: rows.every((row) => row.status === "ok"),
  };
}

export function resolveReadyGatePrepareEntryFailureCopy(input: {
  code?: string | null;
  platform?: ReadyGatePlatform;
}): ReadyGatePrepareEntryFailureCopy {
  const code = normalizeCode(input.code);
  const recovery = resolveReadyGateTerminalRecovery({
    code,
    errorCode: code,
    source: "prepare_entry",
  });

  switch (code) {
    case "UNAUTHORIZED":
    case "auth":
    case "unauthorized":
      return {
        code,
        title: "Sign in again",
        message: "Please sign in again, then try once more.",
        retryable: recovery.retryable,
        terminal: recovery.terminal,
      };
    case "ACCESS_DENIED":
    case "access_denied":
      return {
        code,
        title: "Date unavailable",
        message: input.platform === "native" ? "This date is no longer available." : "You do not have access to this date.",
        retryable: recovery.retryable,
        terminal: recovery.terminal,
      };
  }

  if (!recovery.retryable || code === "EVENT_NOT_ACTIVE") {
    return {
      code,
      title: recovery.title,
      message: recovery.body,
      retryable: recovery.retryable,
      terminal: recovery.terminal,
    };
  }

  switch (code) {
    case "BLOCKED_PAIR":
      return {
        code,
        title: "Date unavailable",
        message: "This call is no longer available.",
        retryable: true,
        terminal: false,
      };
    case "SESSION_ENDED":
      return {
        code,
        title: "Date ended",
        message: "This date has already ended.",
        retryable: true,
        terminal: false,
      };
    case "DAILY_AUTH_FAILED":
    case "DAILY_CREDENTIALS_INVALID":
      return {
        code,
        title: "Video setup unavailable",
        message:
          input.platform === "native"
            ? "Video setup is unavailable right now. Please try again later."
            : "Video provider authentication failed. Please try again later.",
        retryable: true,
        terminal: false,
      };
    case "DAILY_REQUEST_REJECTED":
      return {
        code,
        title: "Video room unavailable",
        message: "The video room could not be prepared. Please try again later.",
        retryable: true,
        terminal: false,
      };
    case "DAILY_RATE_LIMIT":
    case "DAILY_PROVIDER_UNAVAILABLE":
    case "DAILY_PROVIDER_ERROR":
      return {
        code,
        title: "Video service is setting up",
        message: "The video service is still setting up. Please try again in a moment.",
        retryable: true,
        terminal: false,
      };
    default:
      return {
        code,
        title: "Could not prepare date",
        message:
          input.platform === "native"
            ? "Could not prepare this date. Please try again."
            : "We could not prepare the video room. Please try again.",
        retryable: true,
        terminal: false,
      };
  }
}
