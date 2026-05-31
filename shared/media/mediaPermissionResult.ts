export type MediaPermissionStatus =
  | "granted"
  | "promptable"
  | "denied"
  | "denied_retryable"
  | "blocked_settings"
  | "unsupported"
  | "missing_device"
  | "hardware_missing"
  | "constraint_failed"
  | "in_use_or_abort"
  | "in_use";

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
    case "denied_retryable":
    case "constraint_failed":
    case "in_use_or_abort":
    case "in_use":
      return "retry";
    case "denied":
    case "blocked_settings":
      return "open_settings";
    case "missing_device":
    case "hardware_missing":
      return "connect_device";
    case "unsupported":
      return "use_supported_browser";
  }
}

function mediaPermissionSubject(result: MediaPermissionResult): string {
  if (result.kind === "camera") return "camera";
  if (result.kind === "microphone") return "microphone";
  return "camera and microphone";
}

export function mediaPermissionTitle(result: MediaPermissionResult): string {
  switch (result.status) {
    case "unsupported":
      return result.kind === "camera" ? "Camera is not available" : "Recording is not available";
    case "missing_device":
    case "hardware_missing":
      return result.kind === "microphone"
        ? "Microphone not found"
        : result.kind === "camera"
          ? "Camera not found"
          : "Camera or microphone not found";
    case "in_use_or_abort":
    case "in_use":
      return result.kind === "microphone"
        ? "Microphone is busy"
        : result.kind === "camera"
          ? "Camera is busy"
          : "Camera or microphone is busy";
    case "constraint_failed":
      return result.kind === "microphone"
        ? "Microphone setup needs another try"
        : result.kind === "camera"
          ? "Camera setup needs another try"
          : "Camera or microphone setup needs another try";
    case "denied":
    case "denied_retryable":
    case "blocked_settings":
    case "promptable":
    case "granted":
      return result.kind === "microphone"
        ? "Microphone access needed"
        : result.kind === "camera"
          ? "Camera access needed"
          : "Camera and microphone needed";
  }
}

export function mediaPermissionMessage(result: MediaPermissionResult): string {
  const subject = mediaPermissionSubject(result);
  switch (result.status) {
    case "unsupported":
      if (result.kind === "camera") {
        return "This browser cannot use the camera here. Use a supported browser or choose a saved photo if available.";
      }
      if (result.kind === "microphone") {
        return "This browser cannot record audio here. Use a supported browser and try again.";
      }
      return "This browser cannot record video here. Upload a saved video or use a supported browser.";
    case "missing_device":
    case "hardware_missing":
      return `We could not find the required ${subject} on this device.`;
    case "constraint_failed":
      if (result.kind === "microphone") {
        return "Your browser could not start the microphone. Try again.";
      }
      if (result.kind === "camera") {
        return "Your browser could not start the preferred camera. Try again or choose a saved photo if available.";
      }
      return "Your browser could not start the preferred camera or microphone. Try again or upload a saved video.";
    case "in_use_or_abort":
    case "in_use":
      return `Another app or tab may be using the ${subject}. Close it, then try again.`;
    case "denied":
    case "blocked_settings":
      return `Allow ${subject} access in your browser settings, then try again.`;
    case "denied_retryable":
      return `Allow ${subject} access, then try again.`;
    case "promptable":
      return `Allow ${subject} access to continue.`;
    case "granted":
      return `${subject[0].toUpperCase()}${subject.slice(1)} access is ready.`;
  }
}
