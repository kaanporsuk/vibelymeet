/**
 * Haptic feedback utilities for mobile devices.
 * Wraps navigator.vibrate in try-catch for broad compatibility.
 */

export const haptics = {
  /** Light tap — swipe completion, button tap */
  light: () => {
    try { navigator.vibrate?.(10); } catch {}
  },

  /** Medium pulse — match found */
  medium: () => {
    try { navigator.vibrate?.([20, 50, 20]); } catch {}
  },

  /** Celebration — mutual match */
  celebration: () => {
    try { navigator.vibrate?.([50, 100, 50, 100, 100]); } catch {}
  },

  /** Error — soft double-buzz */
  error: () => {
    try { navigator.vibrate?.([30, 40, 30]); } catch {}
  },
};
