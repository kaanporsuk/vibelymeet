// Sound Effects & Haptic Feedback Hook

type SoundType = 'correct' | 'wrong' | 'match' | 'success' | 'click' | 'unlock' | 'notification' | 'superlike' | 'swipe';

const SOUND_URLS: Record<SoundType, string> = {
  correct: 'https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3',
  wrong: 'https://assets.mixkit.co/active_storage/sfx/2001/2001-preview.mp3',
  match: 'https://assets.mixkit.co/active_storage/sfx/2004/2004-preview.mp3',
  success: 'https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3',
  click: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
  unlock: 'https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3',
  notification: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
  superlike: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3',
  swipe: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
};

// Audio cache for preloaded sounds
const audioCache: Map<SoundType, HTMLAudioElement> = new Map();

export type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' | 'selection' | 'swipe';

export function useSoundEffects() {
  // Preload a sound
  const preloadSound = (type: SoundType) => {
    if (!audioCache.has(type)) {
      const audio = new Audio(SOUND_URLS[type]);
      audio.preload = 'auto';
      audioCache.set(type, audio);
    }
  };

  // Play a sound
  const playSound = (type: SoundType, volume: number = 0.5) => {
    try {
      let audio = audioCache.get(type);
      if (!audio) {
        audio = new Audio(SOUND_URLS[type]);
        audioCache.set(type, audio);
      }
      
      // Clone audio for overlapping sounds
      const clone = audio.cloneNode() as HTMLAudioElement;
      clone.volume = Math.min(1, Math.max(0, volume));
      clone.play().catch(() => {
        // Silently fail if autoplay is blocked
      });
    } catch {
      // Silently fail
    }
  };

  // Haptic feedback using Vibration API
  const triggerHaptic = (pattern: HapticPattern) => {
    if (!('vibrate' in navigator)) return;

    const patterns: Record<HapticPattern, number | number[]> = {
      light: 10,
      medium: 25,
      heavy: 50,
      success: [10, 30, 10, 30, 50],
      error: [50, 100, 50],
      warning: [30, 50, 30],
      selection: 15,
      swipe: [5, 10, 5],
    };

    try {
      navigator.vibrate(patterns[pattern]);
    } catch {
      // Silently fail
    }
  };

  // Combined feedback
  const playFeedback = (
    type: SoundType,
    options?: { haptic?: boolean; volume?: number; hapticPattern?: HapticPattern }
  ) => {
    const { haptic = true, volume = 0.5, hapticPattern } = options || {};

    playSound(type, volume);

    if (haptic) {
      // Use provided pattern or derive from sound type
      if (hapticPattern) {
        triggerHaptic(hapticPattern);
      } else {
        switch (type) {
          case 'correct':
          case 'success':
          case 'unlock':
          case 'superlike':
            triggerHaptic('success');
            break;
          case 'wrong':
            triggerHaptic('error');
            break;
          case 'match':
            triggerHaptic('heavy');
            break;
          case 'swipe':
            triggerHaptic('swipe');
            break;
          case 'notification':
            triggerHaptic('warning');
            break;
          default:
            triggerHaptic('light');
        }
      }
    }
  };

  // Specific haptic-only triggers for UI interactions
  const hapticTap = () => triggerHaptic('light');
  const hapticSelection = () => triggerHaptic('selection');
  const hapticSwipe = () => triggerHaptic('swipe');
  const hapticSuccess = () => triggerHaptic('success');
  const hapticError = () => triggerHaptic('error');

  // Preload common sounds on mount
  const preloadAll = () => {
    Object.keys(SOUND_URLS).forEach((type) => {
      preloadSound(type as SoundType);
    });
  };

  return {
    playSound,
    playFeedback,
    triggerHaptic,
    preloadSound,
    preloadAll,
    // Quick haptic helpers
    hapticTap,
    hapticSelection,
    hapticSwipe,
    hapticSuccess,
    hapticError,
  };
}
