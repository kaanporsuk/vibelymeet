export const VIDEO_DATE_REMOTE_OBJECT_FIT = "contain" as const;
export const VIDEO_DATE_SELF_VIEW_OBJECT_FIT = "contain" as const;
export const VIDEO_DATE_REMOTE_OBJECT_POSITION = "center center" as const;

export type VideoDateWebMediaCaptureProfile =
  | "ideal"
  | "portrait_medium"
  | "portrait_compatible"
  | "fallback";
export type VideoDateNativeMediaCaptureProfile = "ideal" | "fallback";

export type VideoDateConstrainNumber =
  | number
  | {
      ideal?: number;
      min?: number;
      max?: number;
    };

export type VideoDateConstrainString =
  | string
  | {
      ideal?: string;
      exact?: string;
    };

export type VideoDateWebVideoConstraints = {
  width?: VideoDateConstrainNumber;
  height?: VideoDateConstrainNumber;
  aspectRatio?: VideoDateConstrainNumber;
  frameRate?: VideoDateConstrainNumber;
  facingMode?: VideoDateConstrainString;
};

export type VideoDateNativeVideoConstraints = {
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: "user" | "environment";
};

export const VIDEO_DATE_CAPTURE_ASPECT_RATIO = 9 / 16;
export const VIDEO_DATE_CAPTURE_WIDTH = 720;
export const VIDEO_DATE_CAPTURE_HEIGHT = 1280;
export const VIDEO_DATE_CAPTURE_FRAME_RATE = 30;
export const VIDEO_DATE_CAPTURE_MEDIUM_WIDTH = 540;
export const VIDEO_DATE_CAPTURE_MEDIUM_HEIGHT = 960;
export const VIDEO_DATE_CAPTURE_COMPATIBLE_WIDTH = 360;
export const VIDEO_DATE_CAPTURE_COMPATIBLE_HEIGHT = 640;

export const VIDEO_DATE_WEB_IDEAL_VIDEO_CONSTRAINTS: VideoDateWebVideoConstraints = {
  width: { ideal: VIDEO_DATE_CAPTURE_WIDTH },
  height: { ideal: VIDEO_DATE_CAPTURE_HEIGHT },
  aspectRatio: { ideal: VIDEO_DATE_CAPTURE_ASPECT_RATIO },
  frameRate: { ideal: VIDEO_DATE_CAPTURE_FRAME_RATE, max: VIDEO_DATE_CAPTURE_FRAME_RATE },
  facingMode: { ideal: "user" },
};

export const VIDEO_DATE_WEB_PORTRAIT_MEDIUM_VIDEO_CONSTRAINTS: VideoDateWebVideoConstraints = {
  width: { ideal: VIDEO_DATE_CAPTURE_MEDIUM_WIDTH },
  height: { ideal: VIDEO_DATE_CAPTURE_MEDIUM_HEIGHT },
  aspectRatio: { ideal: VIDEO_DATE_CAPTURE_ASPECT_RATIO },
  frameRate: { ideal: VIDEO_DATE_CAPTURE_FRAME_RATE, max: VIDEO_DATE_CAPTURE_FRAME_RATE },
  facingMode: { ideal: "user" },
};

export const VIDEO_DATE_WEB_PORTRAIT_COMPATIBLE_VIDEO_CONSTRAINTS: VideoDateWebVideoConstraints = {
  width: { ideal: VIDEO_DATE_CAPTURE_COMPATIBLE_WIDTH },
  height: { ideal: VIDEO_DATE_CAPTURE_COMPATIBLE_HEIGHT },
  aspectRatio: { ideal: VIDEO_DATE_CAPTURE_ASPECT_RATIO },
  frameRate: { ideal: 24, max: VIDEO_DATE_CAPTURE_FRAME_RATE },
  facingMode: { ideal: "user" },
};

export const VIDEO_DATE_WEB_FALLBACK_VIDEO_CONSTRAINTS: VideoDateWebVideoConstraints = {
  facingMode: { ideal: "user" },
};

export const VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER = [
  "ideal",
  "portrait_medium",
  "portrait_compatible",
  "fallback",
] as const satisfies readonly VideoDateWebMediaCaptureProfile[];

export const VIDEO_DATE_NATIVE_IDEAL_VIDEO_CONSTRAINTS: VideoDateNativeVideoConstraints = {
  frameRate: VIDEO_DATE_CAPTURE_FRAME_RATE,
  facingMode: "user",
};

export const VIDEO_DATE_NATIVE_FALLBACK_VIDEO_CONSTRAINTS: VideoDateNativeVideoConstraints = {
  facingMode: "user",
};

export function videoDateWebVideoConstraintsForProfile(
  profile: VideoDateWebMediaCaptureProfile,
): VideoDateWebVideoConstraints {
  switch (profile) {
    case "portrait_medium":
      return VIDEO_DATE_WEB_PORTRAIT_MEDIUM_VIDEO_CONSTRAINTS;
    case "portrait_compatible":
      return VIDEO_DATE_WEB_PORTRAIT_COMPATIBLE_VIDEO_CONSTRAINTS;
    case "fallback":
      return VIDEO_DATE_WEB_FALLBACK_VIDEO_CONSTRAINTS;
    case "ideal":
    default:
      return VIDEO_DATE_WEB_IDEAL_VIDEO_CONSTRAINTS;
  }
}

export function videoDateNativeVideoConstraintsForProfile(
  profile: VideoDateNativeMediaCaptureProfile,
): VideoDateNativeVideoConstraints {
  return profile === "fallback"
    ? VIDEO_DATE_NATIVE_FALLBACK_VIDEO_CONSTRAINTS
    : VIDEO_DATE_NATIVE_IDEAL_VIDEO_CONSTRAINTS;
}

export function videoDateAspectRatio(width: unknown, height: unknown): number | null {
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
    return null;
  }
  return Number((width / height).toFixed(4));
}

export function isVideoDateCameraConstraintError(error: unknown): boolean {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return (
    ["OverconstrainedError", "ConstraintNotSatisfiedError", "NotFoundError"].includes(name) ||
    /\bconstraint|overconstrained|not\s*found|camera.*resolution|video.*source/i.test(message)
  );
}
