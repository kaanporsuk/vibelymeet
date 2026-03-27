/**
 * Shared UX copy for Vibe Clip capture / send (native + web).
 * Transport and publish paths are unchanged — copy only.
 */

export const VIBE_CLIP_SHEET_TITLE = "Send a Vibe Clip";

export const VIBE_CLIP_SHEET_SUBTITLE =
  "A short, real hello on video — the fastest way to turn chat chemistry into something human.";

export const VIBE_CLIP_RECORD_PRIMARY = "Record";

export const VIBE_CLIP_RECORD_SECONDARY =
  "Front camera · quick take — say hi, smile, show your vibe.";

export const VIBE_CLIP_LIBRARY = "Choose from library";

export const VIBE_CLIP_LIBRARY_HINT = "Use a clip you already love.";

/** Permission — camera (native Alert). */
export const VIBE_CLIP_PERM_CAMERA_TITLE = "Camera access";

export const VIBE_CLIP_PERM_CAMERA_MESSAGE =
  "Vibely needs your camera to record a clip for this chat. You can always pick one from your library instead.";

/** Permission — photo library (native Alert). */
export const VIBE_CLIP_PERM_LIBRARY_TITLE = "Photo library";

export const VIBE_CLIP_PERM_LIBRARY_MESSAGE =
  "Allow access so you can share a saved clip. We only use what you pick.";

/** Web recorder — idle / recording hints */
export const VIBE_CLIP_RECORDER_TAGLINE = "Quick vibe check";

export const VIBE_CLIP_RECORDER_IDLE_HINT =
  "Tap when you’re ready — up to 59s · front camera by default";

export const VIBE_CLIP_RECORDER_RECORDING_REMAINING = (sec: number) =>
  `${sec}s left`;

/** Outbox / pending (native thread footer) */
export const VIBE_CLIP_OUTBOX_QUEUED = "Getting your clip ready…";

export const VIBE_CLIP_OUTBOX_WAITING_NET = "Waiting for a connection…";

export const VIBE_CLIP_OUTBOX_SENDING = "Sending your clip…";

export const VIBE_CLIP_OUTBOX_FAILED = "Couldn’t send — tap retry";

/** Web / app toasts (publish path) */
export const VIBE_CLIP_TOAST_SENT = "Your clip is on its way";

export const VIBE_CLIP_TOAST_SEND_FAIL = "Couldn't send your clip — try again";

export const VIBE_CLIP_TOAST_UPLOAD_FAIL = "Couldn't upload your clip — try again";

/** Web recorder — camera errors */
export const VIBE_CLIP_WEB_TOAST_CAMERA_DENIED =
  "We need camera access to record your Vibe Clip — or allow access in your browser settings.";

export const VIBE_CLIP_WEB_TOAST_UNSUPPORTED = "Recording isn't supported in this browser.";

export const VIBE_CLIP_WEB_TOAST_CAMERA_GENERIC = "We couldn't open your camera. Try again.";
