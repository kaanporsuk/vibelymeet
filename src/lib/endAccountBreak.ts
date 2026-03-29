/** Clears account / discovery pause — same fields as native and AccountSettingsDrawer “End break”. */
// SAFETY CONTRACT: This update clears pause/discovery flags ONLY.
// It NEVER touches is_suspended, suspension_reason, or any
// trust & safety state. Moderation actions are independent of breaks.
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
