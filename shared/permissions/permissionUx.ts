import type { MediaPermissionStatus } from "../media/mediaPermissionResult";

export type PermissionCapability =
  | "video_date_media"
  | "match_call_voice"
  | "match_call_video"
  | "chat_vibe_clip"
  | "profile_vibe_video"
  | "voice_message"
  | "photo_capture"
  | "photo_picker"
  | "photo_verification"
  | "location_nearby"
  | "push_notifications"
  | "speech_captions";

export type PermissionUxStatus =
  | "checking"
  | "granted"
  | "promptable"
  | "denied_retryable"
  | "blocked_settings"
  | "limited"
  | "services_off"
  | "hardware_missing"
  | "in_use"
  | "unsupported";

export type PermissionUxAction =
  | "none"
  | "request"
  | "retry"
  | "open_settings"
  | "use_picker"
  | "upload_file"
  | "manual_entry"
  | "continue_without_optional"
  | "dismiss";

export type PermissionUxPlatform = "ios" | "android" | "native" | "web" | "mobile_web";

export type PermissionMediaKind = "camera" | "microphone" | "camera_microphone";

export type PermissionUxCopy = {
  title: string;
  message: string;
  primaryAction: PermissionUxAction;
  primaryLabel: string;
  secondaryAction?: PermissionUxAction;
  secondaryLabel?: string;
  fallbackAction?: PermissionUxAction;
  fallbackLabel?: string;
};

type CapabilityCopy = {
  title: string;
  requestMessage: string;
  settingsMessage: string;
  retryMessage?: string;
  primaryPromptLabel: string;
  fallbackAction?: PermissionUxAction;
  fallbackLabel?: string;
  optional?: boolean;
};

type PermissionGrantLike = {
  granted?: boolean | null;
  status?: string | null;
  canAskAgain?: boolean | null;
};

const CAPABILITY_COPY: Record<PermissionCapability, CapabilityCopy> = {
  video_date_media: {
    title: "Camera and microphone needed",
    requestMessage: "Allow access so you can join the video date with sound and video.",
    settingsMessage: "Camera or microphone access is off for Vibely. Re-enable it in Settings, then return here.",
    primaryPromptLabel: "Allow camera & mic",
  },
  match_call_voice: {
    title: "Microphone needed",
    requestMessage: "Allow microphone access before starting the voice call.",
    settingsMessage: "Microphone access is off for Vibely. Re-enable it in Settings, then return to the call.",
    primaryPromptLabel: "Allow microphone",
  },
  match_call_video: {
    title: "Camera and microphone needed",
    requestMessage: "Allow access before starting the video call with sound and video.",
    settingsMessage: "Camera or microphone access is off for Vibely. Re-enable it in Settings, then return to the call.",
    primaryPromptLabel: "Allow camera & mic",
  },
  chat_vibe_clip: {
    title: "Camera and microphone needed",
    requestMessage: "Allow access to record a short captioned clip for this chat.",
    settingsMessage: "Camera or microphone access is off for Vibely. Re-enable it in Settings, then return to record.",
    primaryPromptLabel: "Allow camera & mic",
    fallbackAction: "upload_file",
    fallbackLabel: "Choose saved video",
  },
  profile_vibe_video: {
    title: "Camera and microphone needed",
    requestMessage: "Allow access to record your Vibe Video with sound.",
    settingsMessage: "Camera or microphone access is off for Vibely. Re-enable it in Settings, then return to record.",
    primaryPromptLabel: "Allow camera & mic",
    fallbackAction: "upload_file",
    fallbackLabel: "Choose saved video",
  },
  voice_message: {
    title: "Microphone needed",
    requestMessage: "Allow microphone access to send a voice message.",
    settingsMessage: "Microphone access is off for Vibely. Re-enable it in Settings, then return to record.",
    primaryPromptLabel: "Allow microphone",
  },
  photo_capture: {
    title: "Camera needed",
    requestMessage: "Allow camera access to take a photo.",
    settingsMessage: "Camera access is off for Vibely. Re-enable it in Settings, then return to take a photo.",
    primaryPromptLabel: "Allow camera",
    fallbackAction: "use_picker",
    fallbackLabel: "Choose from library",
  },
  photo_picker: {
    title: "Choose a photo",
    requestMessage: "Choose the photos you want to share. Vibely only uses what you pick.",
    settingsMessage: "Photo access is off for Vibely. Re-enable it in Settings, or choose a file if available.",
    primaryPromptLabel: "Choose photo",
    fallbackAction: "upload_file",
    fallbackLabel: "Choose file",
  },
  photo_verification: {
    title: "Camera needed",
    requestMessage: "Allow camera access to take the selfie used for verification review.",
    settingsMessage: "Camera access is off for Vibely. Re-enable it in Settings, then return to take your selfie.",
    primaryPromptLabel: "Allow camera",
  },
  location_nearby: {
    title: "Location needed",
    requestMessage: "Allow location access to show nearby events and people.",
    settingsMessage: "Location access is off for Vibely. Re-enable it in Settings, or enter your city manually.",
    primaryPromptLabel: "Allow location",
    fallbackAction: "manual_entry",
    fallbackLabel: "Enter city",
    optional: true,
  },
  push_notifications: {
    title: "Turn notifications on",
    requestMessage: "Allow notifications so you do not miss matches, messages, and date activity.",
    settingsMessage: "Notifications are off for Vibely. Re-enable them in Settings when you want alerts again.",
    primaryPromptLabel: "Allow notifications",
    optional: true,
  },
  speech_captions: {
    title: "Captions are optional",
    requestMessage: "Allow speech recognition to create captions while you record.",
    settingsMessage: "Speech recognition is off for Vibely. You can still record and add captions manually.",
    primaryPromptLabel: "Allow captions",
    fallbackAction: "continue_without_optional",
    fallbackLabel: "Continue without captions",
    optional: true,
  },
};

const REQUIRED_MEDIA_CAPABILITIES = new Set<PermissionCapability>([
  "video_date_media",
  "match_call_video",
  "chat_vibe_clip",
  "profile_vibe_video",
]);

function mediaPurpose(capability: PermissionCapability, mediaKind: PermissionMediaKind): string {
  if (capability === "video_date_media") {
    return mediaKind === "camera"
      ? "join the video date with video"
      : mediaKind === "microphone"
        ? "join the video date with sound"
        : "join the video date with sound and video";
  }
  if (capability === "match_call_video") {
    return mediaKind === "camera"
      ? "start the video call with video"
      : mediaKind === "microphone"
        ? "start the video call with sound"
        : "start the video call with sound and video";
  }
  if (capability === "chat_vibe_clip") {
    return mediaKind === "camera"
      ? "record a short clip for this chat"
      : mediaKind === "microphone"
        ? "record sound for your clip"
        : "record a short captioned clip for this chat";
  }
  if (capability === "profile_vibe_video") {
    return mediaKind === "camera"
      ? "record your Vibe Video"
      : mediaKind === "microphone"
        ? "record sound for your Vibe Video"
        : "record your Vibe Video with sound";
  }
  return mediaKind === "microphone" ? "record sound" : "use the camera";
}

function mediaSettingsReturn(capability: PermissionCapability): string {
  switch (capability) {
    case "chat_vibe_clip":
      return "return to record";
    case "profile_vibe_video":
      return "return to record";
    case "video_date_media":
      return "return here";
    case "match_call_video":
      return "return to the call";
    default:
      return "return to Vibely";
  }
}

function copyForRequiredMediaKind(
  capability: PermissionCapability,
  base: CapabilityCopy,
  mediaKind?: PermissionMediaKind,
): CapabilityCopy {
  if (!mediaKind || mediaKind === "camera_microphone" || !REQUIRED_MEDIA_CAPABILITIES.has(capability)) {
    return base;
  }

  const subject = mediaKind === "camera" ? "Camera" : "Microphone";
  const subjectLower = subject.toLowerCase();
  return {
    ...base,
    title: `${subject} needed`,
    requestMessage: `Allow ${subjectLower} access to ${mediaPurpose(capability, mediaKind)}.`,
    settingsMessage: `${subject} access is off for Vibely. Re-enable it in Settings, then ${mediaSettingsReturn(capability)}.`,
    primaryPromptLabel: `Allow ${subjectLower}`,
  };
}

function primaryActionForStatus(status: PermissionUxStatus, copy: CapabilityCopy): PermissionUxAction {
  switch (status) {
    case "checking":
    case "granted":
      return "none";
    case "promptable":
      return "request";
    case "denied_retryable":
    case "in_use":
      return "retry";
    case "blocked_settings":
    case "limited":
    case "services_off":
      return "open_settings";
    case "hardware_missing":
      return "dismiss";
    case "unsupported":
      return copy.fallbackAction ?? "dismiss";
  }
}

function primaryLabelForStatus(status: PermissionUxStatus, copy: CapabilityCopy): string {
  switch (status) {
    case "checking":
    case "granted":
      return "Done";
    case "promptable":
      return copy.primaryPromptLabel;
    case "denied_retryable":
    case "in_use":
      return "Try again";
    case "blocked_settings":
    case "limited":
    case "services_off":
      return "Open Settings";
    case "hardware_missing":
      return "OK";
    case "unsupported":
      return copy.fallbackLabel ?? "OK";
  }
}

function messageForStatus(status: PermissionUxStatus, copy: CapabilityCopy): string {
  switch (status) {
    case "checking":
      return "Checking access on this device...";
    case "granted":
      return "Access is ready.";
    case "promptable":
      return copy.requestMessage;
    case "denied_retryable":
      return copy.retryMessage ?? copy.requestMessage;
    case "blocked_settings":
    case "limited":
      return copy.settingsMessage;
    case "services_off":
      return "Device services are off. Turn them on in Settings, then try again.";
    case "hardware_missing":
      return "This device does not have the required camera, microphone, or sensor.";
    case "in_use":
      return "Another app or browser tab may be using this device. Close it, then try again.";
    case "unsupported":
      return "This device or browser does not support this capture flow.";
  }
}

export function resolvePermissionUx(params: {
  capability: PermissionCapability;
  status: PermissionUxStatus;
  platform?: PermissionUxPlatform;
  mediaKind?: PermissionMediaKind;
}): PermissionUxCopy {
  const copy = copyForRequiredMediaKind(
    params.capability,
    CAPABILITY_COPY[params.capability],
    params.mediaKind,
  );
  const primaryAction = primaryActionForStatus(params.status, copy);
  const result: PermissionUxCopy = {
    title: copy.title,
    message: messageForStatus(params.status, copy),
    primaryAction,
    primaryLabel: primaryLabelForStatus(params.status, copy),
    secondaryAction: copy.optional ? "continue_without_optional" : "dismiss",
    secondaryLabel: copy.optional ? "Not now" : "Cancel",
  };

  if (copy.fallbackAction && params.status !== "granted" && primaryAction !== copy.fallbackAction) {
    result.fallbackAction = copy.fallbackAction;
    result.fallbackLabel = copy.fallbackLabel;
  }

  if (params.platform === "web" || params.platform === "mobile_web") {
    if (params.status === "blocked_settings") {
      result.message = `${copy.settingsMessage} Use your browser site settings, then try again.`;
      result.primaryAction = "retry";
      result.primaryLabel = "I updated settings";
    }
  }

  return result;
}

export function permissionUxStatusFromGrant(params: {
  granted?: boolean | null;
  status?: string | null;
  canAskAgain?: boolean | null;
}): PermissionUxStatus {
  if (params.granted || params.status === "granted") return "granted";
  if (params.status === "limited") return "limited";
  if (params.status === "undetermined" || params.status === "prompt") return "promptable";
  if (params.status === "never_ask_again") return "blocked_settings";
  if (params.canAskAgain === false) return "blocked_settings";
  if (params.status === "denied") return "denied_retryable";
  return "promptable";
}

export function permissionUxStatusForRequiredGrants(
  grants: Array<PermissionGrantLike | null | undefined>,
): PermissionUxStatus {
  const known = grants.filter((grant): grant is PermissionGrantLike => grant != null);
  if (known.length === 0) return "checking";
  if (known.length < grants.length) return "checking";
  if (known.every((grant) => grant.granted || grant.status === "granted")) return "granted";

  const statuses = known.map((grant) => permissionUxStatusFromGrant(grant));
  if (statuses.includes("blocked_settings")) return "blocked_settings";
  if (statuses.includes("limited")) return "blocked_settings";
  if (statuses.includes("denied_retryable")) return "denied_retryable";
  if (statuses.includes("promptable")) return "promptable";
  return statuses[0] ?? "promptable";
}

function isGrantGranted(grant: PermissionGrantLike | null | undefined): boolean {
  return Boolean(grant?.granted || grant?.status === "granted");
}

export function permissionUxMediaKindForRequiredGrants(
  cameraGrant: PermissionGrantLike | null | undefined,
  microphoneGrant: PermissionGrantLike | null | undefined,
): PermissionMediaKind {
  const cameraGranted = isGrantGranted(cameraGrant);
  const microphoneGranted = isGrantGranted(microphoneGrant);
  if (!cameraGranted && microphoneGranted) return "camera";
  if (cameraGranted && !microphoneGranted) return "microphone";
  return "camera_microphone";
}

export function permissionUxStatusFromMediaPermissionStatus(status: MediaPermissionStatus): PermissionUxStatus {
  switch (status) {
    case "granted":
      return "granted";
    case "promptable":
      return "promptable";
    case "denied":
    case "blocked_settings":
      return "blocked_settings";
    case "missing_device":
    case "hardware_missing":
      return "hardware_missing";
    case "constraint_failed":
    case "denied_retryable":
      return "denied_retryable";
    case "in_use_or_abort":
    case "in_use":
      return "in_use";
    case "unsupported":
      return "unsupported";
    default:
      return "denied_retryable";
  }
}

export function permissionUxStatusFromBrowserMediaStatus(status: string): PermissionUxStatus {
  return permissionUxStatusFromMediaPermissionStatus(status as MediaPermissionStatus);
}
