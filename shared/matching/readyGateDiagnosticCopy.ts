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

function normalizeCode(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function severityForStatus(status: ReadyGateDiagnosticStatus): ReadyGateDiagnosticSeverity {
  if (status === "ok") return "success";
  if (status === "blocked" || status === "failed") return "error";
  if (status === "warning") return "warning";
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
