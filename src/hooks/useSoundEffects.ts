// Sound Effects & Haptic Feedback Hook

type SoundType = 'correct' | 'wrong' | 'match' | 'success' | 'click' | 'unlock' | 'notification';

const SOUND_URLS: Record<SoundType, string> = {
  correct: 'https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3',
  wrong: 'https://assets.mixkit.co/active_storage/sfx/2001/2001-preview.mp3',
  match: 'https://assets.mixkit.co/active_storage/sfx/2004/2004-preview.mp3',
  success: 'https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3',
  click: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
  unlock: 'https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3',
  notification: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
};

// Audio cache for preloaded sounds
const audioCache: Map<SoundType, HTMLAudioElement> = new Map();

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
  const triggerHaptic = (pattern: 'light' | 'medium' | 'heavy' | 'success' | 'error') => {
    if (!('vibrate' in navigator)) return;

    const patterns: Record<typeof pattern, number | number[]> = {
      light: 10,
      medium: 25,
      heavy: 50,
      success: [10, 30, 10, 30, 50],
      error: [50, 100, 50],
    };

    try {
      navigator.vibrate(patterns[pattern]);
    } catch {
      // Silently fail
    }
  };

  // Combined feedback
  const playFeedback = (
    type: 'correct' | 'wrong' | 'match' | 'success' | 'click' | 'unlock' | 'notification',
    options?: { haptic?: boolean; volume?: number }
  ) => {
    const { haptic = true, volume = 0.5 } = options || {};

    playSound(type, volume);

    if (haptic) {
      switch (type) {
        case 'correct':
        case 'success':
        case 'unlock':
          triggerHaptic('success');
          break;
        case 'wrong':
          triggerHaptic('error');
          break;
        case 'match':
          triggerHaptic('heavy');
          break;
        default:
          triggerHaptic('light');
      }
    }
  };

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
  };
}
