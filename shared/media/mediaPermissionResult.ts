export type MediaPermissionStatus =
  | "granted"
  | "promptable"
  | "denied"
  | "unsupported"
  | "missing_device"
  | "constraint_failed"
  | "in_use_or_abort";

export type MediaPermissionKind = "camera" | "microphone" | "camera_microphone";

export type MediaPermissionRecoveryAction =
  | "none"
  | "retry"
  | "open_settings"
  | "choose_upload"
  | "use_supported_browser"
  | "connect_device";

export type MediaPermissionQueryState = "granted" | "prompt" | "denied" | "unknown" | "unsupported";

export type MediaPermissionResult = {
  status: MediaPermissionStatus;
  kind: MediaPermissionKind;
  permissionState: MediaPermissionQueryState;
  recoveryAction: MediaPermissionRecoveryAction;
  rawErrorName: string | null;
  rawErrorMessage: string | null;
};

function errorField(error: unknown, field: "name" | "message"): string | null {
  if (!error || typeof error !== "object" || !(field in error)) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mediaPermissionResultForStatus(params: {
  status: MediaPermissionStatus;
  kind: MediaPermissionKind;
  permissionState?: MediaPermissionQueryState;
  rawErrorName?: string | null;
  rawErrorMessage?: string | null;
}): MediaPermissionResult {
  const recoveryAction = recoveryActionForStatus(params.status);
  return {
    status: params.status,
    kind: params.kind,
    permissionState: params.permissionState ?? (params.status === "granted" ? "granted" : "unknown"),
    recoveryAction,
    rawErrorName: params.rawErrorName ?? null,
    rawErrorMessage: params.rawErrorMessage ?? null,
  };
}

export function mediaPermissionResultForQueryState(
  kind: MediaPermissionKind,
  state: MediaPermissionQueryState,
): MediaPermissionResult {
  if (state === "granted") return mediaPermissionResultForStatus({ status: "granted", kind, permissionState: state });
  if (state === "denied") return mediaPermissionResultForStatus({ status: "denied", kind, permissionState: state });
  if (state === "prompt") return mediaPermissionResultForStatus({ status: "promptable", kind, permissionState: state });
  if (state === "unsupported") {
    return mediaPermissionResultForStatus({ status: "unsupported", kind, permissionState: state });
  }
  return mediaPermissionResultForStatus({ status: "promptable", kind, permissionState: state });
}

export function classifyMediaPermissionError(
  error: unknown,
  kind: MediaPermissionKind,
): MediaPermissionResult {
  const rawErrorName = errorField(error, "name");
  const rawErrorMessage = errorField(error, "message");
  const name = rawErrorName ?? "";
  const message = rawErrorMessage ?? String(error ?? "");

  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name)) {
    return mediaPermissionResultForStatus({
      status: "denied",
      kind,
      permissionState: "denied",
      rawErrorName,
      rawErrorMessage,
    });
  }

  if (["NotSupportedError", "TypeError"].includes(name)) {
    return mediaPermissionResultForStatus({
      status: "unsupported",
      kind,
      permissionState: "unsupported",
      rawErrorName,
      rawErrorMessage,
    });
  }

  if (["NotFoundError", "DevicesNotFoundError"].includes(name)) {
    return mediaPermissionResultForStatus({
      status: "missing_device",
      kind,
      rawErrorName,
      rawErrorMessage,
    });
  }

  if (
    ["OverconstrainedError", "ConstraintNotSatisfiedError"].includes(name) ||
    /\bconstraint|overconstrained|resolution|facingMode/i.test(message)
  ) {
    return mediaPermissionResultForStatus({
      status: "constraint_failed",
      kind,
      rawErrorName,
      rawErrorMessage,
    });
  }

  if (["AbortError", "NotReadableError", "TrackStartError"].includes(name)) {
    return mediaPermissionResultForStatus({
      status: "in_use_or_abort",
      kind,
      rawErrorName,
      rawErrorMessage,
    });
  }

  return mediaPermissionResultForStatus({
    status: "in_use_or_abort",
    kind,
    rawErrorName,
    rawErrorMessage,
  });
}

export function isMediaPermissionDeniedError(error: unknown): boolean {
  return classifyMediaPermissionError(error, "camera_microphone").status === "denied";
}

export function shouldRetryMediaPermissionWithFallback(error: unknown): boolean {
  const result = classifyMediaPermissionError(error, "camera_microphone");
  return result.status === "constraint_failed";
}

function recoveryActionForStatus(status: MediaPermissionStatus): MediaPermissionRecoveryAction {
  switch (status) {
    case "granted":
      return "none";
    case "promptable":
    case "constraint_failed":
    case "in_use_or_abort":
      return "retry";
    case "denied":
      return "open_settings";
    case "missing_device":
      return "connect_device";
    case "unsupported":
      return "use_supported_browser";
  }
}

export function mediaPermissionTitle(result: MediaPermissionResult): string {
  switch (result.status) {
    case "unsupported":
      return "Recording is not available";
    case "missing_device":
      return result.kind === "microphone" ? "Microphone not found" : "Camera not found";
    case "in_use_or_abort":
      return "Camera or microphone is busy";
    case "constraint_failed":
      return "Camera setup needs another try";
    case "denied":
    case "promptable":
    case "granted":
      return result.kind === "microphone" ? "Microphone access needed" : "Camera and microphone needed";
  }
}

export function mediaPermissionMessage(result: MediaPermissionResult): string {
  switch (result.status) {
    case "unsupported":
      return "This browser cannot record a Vibe Video. Upload a saved video instead.";
    case "missing_device":
      return "We could not find the required camera or microphone on this device.";
    case "constraint_failed":
      return "Your browser could not start the preferred camera. Try again or upload a saved video.";
    case "in_use_or_abort":
      return "Another app or tab may be using the camera or microphone. Close it, then try again.";
    case "denied":
      return "Allow camera and microphone access in your browser settings, then try again.";
    case "promptable":
      return "Allow camera and microphone access to record your Vibe Video.";
    case "granted":
      return "Camera and microphone access is ready.";
  }
}
