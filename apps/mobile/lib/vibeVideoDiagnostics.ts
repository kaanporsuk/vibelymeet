/**
 * Engineering diagnostics for Vibe Video — never user-facing alerts.
 * __DEV__: verbose objects. Production: rare one-line hints for log aggregation (no PII).
 *
 * Common `code` strings (grep / log drains):
 * `edge.non_json`, `create-upload.*`, `tus.*`, `delete-vibe-video.*`, `poll.*`,
 * `fullscreen.player_status_error`, `studio.profile_inconsistent_ready_no_uid`
 * — see `apps/mobile/docs/native-vibe-video-runbook.md`.
 */

type VibeDiagPayload = Record<string, unknown> | undefined;

const PREFIX = '[VibeVideo]';

export function vibeVideoDiagVerbose(code: string, payload?: VibeDiagPayload): void {
  if (!__DEV__) return;
  if (payload) {
    console.warn(`${PREFIX} ${code}`, payload);
  } else {
    console.warn(`${PREFIX} ${code}`);
  }
}

/** Use sparingly in production for non-PII operational signals (e.g. delete edge failure category). */
export function vibeVideoDiagProdHint(code: string, detail?: string): void {
  if (__DEV__) {
    vibeVideoDiagVerbose(code, detail ? { detail } : undefined);
    return;
  }
  console.warn(`${PREFIX} ${code}${detail ? `: ${detail}` : ''}`);
}
