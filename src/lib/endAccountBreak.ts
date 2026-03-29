/** Clears account / discovery pause — same fields as native and AccountSettingsDrawer “End break”. */
export const END_ACCOUNT_BREAK_PROFILE_UPDATE = {
  account_paused: false,
  account_paused_until: null,
  is_paused: false,
  paused_until: null,
  paused_at: null,
  pause_reason: null,
  discoverable: true,
  discovery_mode: "visible" as const,
};
