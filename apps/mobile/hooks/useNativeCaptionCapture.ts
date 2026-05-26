import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { getLocales } from 'expo-localization';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type {
  ExpoSpeechRecognitionNativeEventMap,
  ExpoSpeechRecognitionResultEvent,
  ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';
import { trackEvent } from '@/lib/analytics';
import type { MediaCaptions } from '../../../shared/media/captions';

type CaptionCaptureSurface =
  | 'native_chat_vibe_clip_recorder'
  | 'native_vibe_video_recorder';

type ExpoSpeechRecognitionRuntime = typeof import('expo-speech-recognition');
type ExpoSpeechRecognitionModuleApi = ExpoSpeechRecognitionRuntime['ExpoSpeechRecognitionModule'];
type SpeechRecognitionEventName = keyof ExpoSpeechRecognitionNativeEventMap;
type SpeechRecognitionEventListener<K extends SpeechRecognitionEventName> = (
  event: ExpoSpeechRecognitionNativeEventMap[K],
) => void;
type EventSubscriptionLike = {
  remove: () => void;
};

let cachedSpeechRecognitionModule: ExpoSpeechRecognitionModuleApi | undefined;

function isNativeSpeechRecognitionModuleAvailable(): boolean {
  return !!requireOptionalNativeModule('ExpoSpeechRecognition');
}

function loadSpeechRecognitionModule(): ExpoSpeechRecognitionModuleApi | null {
  if (cachedSpeechRecognitionModule) return cachedSpeechRecognitionModule;
  if (!isNativeSpeechRecognitionModuleAvailable()) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module for stale dev clients
    const speechRecognition = require('expo-speech-recognition') as Pick<
      ExpoSpeechRecognitionRuntime,
      'ExpoSpeechRecognitionModule'
    >;
    cachedSpeechRecognitionModule = speechRecognition.ExpoSpeechRecognitionModule;
  } catch {
    return null;
  }
  return cachedSpeechRecognitionModule ?? null;
}

function useSafeSpeechRecognitionEvent<K extends SpeechRecognitionEventName>(
  eventName: K,
  listener: SpeechRecognitionEventListener<K>,
) {
  const listenerRef = useRef(listener);

  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);

  useEffect(() => {
    const speechRecognition = loadSpeechRecognitionModule();
    if (!speechRecognition) return undefined;

    let subscription: EventSubscriptionLike | null = null;
    try {
      subscription = (speechRecognition.addListener as (
        name: SpeechRecognitionEventName,
        next: (event: unknown) => void,
      ) => EventSubscriptionLike).call(
        speechRecognition,
        eventName,
        (event) => {
          listenerRef.current(event as ExpoSpeechRecognitionNativeEventMap[K]);
        },
      );
    } catch {
      return undefined;
    }

    return () => {
      try {
        subscription?.remove();
      } catch {
        // Best effort; listener cleanup should not make the recorder unusable.
      }
    };
  }, [eventName]);
}

function languageTag(): string {
  const locale = getLocales()[0]?.languageTag;
  return typeof locale === 'string' && locale.trim() ? locale.trim() : 'en-US';
}

function normalizeCaptionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function captionParts(finalParts: string[], interim: string): string {
  return normalizeCaptionText([...finalParts, interim].filter(Boolean).join(' '));
}

function captionsFromText(text: string, language: string): MediaCaptions | null {
  const normalized = normalizeCaptionText(text);
  if (!normalized) return null;
  return {
    text: normalized,
    language,
    cues: [
      {
        startMs: 0,
        endMs: Math.max(1000, Math.min(30_000, normalized.length * 45)),
        text: normalized,
      },
    ],
  };
}

export function useNativeCaptionCapture(surface: CaptionCaptureSurface) {
  const [transcript, setTranscript] = useState('');
  const [recognizing, setRecognizing] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const activeRef = useRef(false);
  const stoppingRef = useRef(false);
  const runIdRef = useRef(0);
  const finalPartsRef = useRef<string[]>([]);
  const interimRef = useRef('');
  const languageRef = useRef(languageTag());

  const refreshTranscript = useCallback(() => {
    const next = captionParts(finalPartsRef.current, interimRef.current);
    setTranscript(next);
    return next;
  }, []);

  const markUnavailable = useCallback((reason: string) => {
    activeRef.current = false;
    setRecognizing(false);
    setUnavailableReason(reason);
    trackEvent('caption_capture_unavailable', {
      surface,
      platform: Platform.OS,
      reason,
    });
  }, [surface]);

  const startRecognitionForRun = useCallback((runId: number): boolean => {
    if (runIdRef.current !== runId || stoppingRef.current || !activeRef.current) return false;
    const speechRecognition = loadSpeechRecognitionModule();
    if (!speechRecognition) {
      markUnavailable('native_module_unavailable');
      return false;
    }
    try {
      speechRecognition.start({
        lang: languageRef.current,
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
      });
      setRecognizing(true);
      return true;
    } catch {
      if (runIdRef.current === runId) {
        markUnavailable('recognition_start_failed');
      }
      return false;
    }
  }, [markUnavailable]);

  useSafeSpeechRecognitionEvent('start', () => {
    if (!activeRef.current) return;
    setRecognizing(true);
  });

  useSafeSpeechRecognitionEvent('end', () => {
    if (!activeRef.current) return;
    setRecognizing(false);
    refreshTranscript();
    if (stoppingRef.current) {
      activeRef.current = false;
      stoppingRef.current = false;
      return;
    }
    startRecognitionForRun(runIdRef.current);
  });

  useSafeSpeechRecognitionEvent('result', (event: ExpoSpeechRecognitionResultEvent) => {
    if (!activeRef.current) return;
    const text = normalizeCaptionText(event.results.map((r) => r.transcript).filter(Boolean).join(' '));
    if (!text) return;
    if (event.isFinal) {
      finalPartsRef.current.push(text);
      interimRef.current = '';
    } else {
      interimRef.current = text;
    }
    refreshTranscript();
  });

  useSafeSpeechRecognitionEvent('error', (event: ExpoSpeechRecognitionErrorEvent) => {
    if (!activeRef.current) return;
    const stoppedByUser = stoppingRef.current && event.error === 'aborted';
    if (stoppedByUser) return;
    setUnavailableReason(event.error);
    setRecognizing(false);
    trackEvent('caption_capture_failed', {
      surface,
      platform: Platform.OS,
      error_code: event.error,
    });
  });

  const reset = useCallback(() => {
    finalPartsRef.current = [];
    interimRef.current = '';
    languageRef.current = languageTag();
    setTranscript('');
    setUnavailableReason(null);
  }, []);

  const snapshot = useCallback(() => {
    const text = refreshTranscript();
    return {
      text,
      language: languageRef.current,
      captions: captionsFromText(text, languageRef.current),
      unavailableReason,
    };
  }, [refreshTranscript, unavailableReason]);

  const start = useCallback(async (): Promise<boolean> => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    reset();
    languageRef.current = languageTag();
    activeRef.current = true;
    stoppingRef.current = false;

    const speechRecognition = loadSpeechRecognitionModule();
    if (!speechRecognition) {
      markUnavailable('native_module_unavailable');
      return false;
    }

    const available = speechRecognition.isRecognitionAvailable();
    if (!available) {
      markUnavailable('recognition_unavailable');
      return false;
    }

    let permissions;
    try {
      permissions = await speechRecognition.requestPermissionsAsync();
    } catch {
      if (runIdRef.current === runId) {
        markUnavailable('permission_request_failed');
      }
      return false;
    }

    if (runIdRef.current !== runId || stoppingRef.current || !activeRef.current) {
      return false;
    }

    if (!permissions.granted) {
      markUnavailable('permission_denied');
      return false;
    }

    const onDevice = speechRecognition.supportsOnDeviceRecognition();
    if (!onDevice) {
      markUnavailable('on_device_recognition_unavailable');
      return false;
    }
    setRecognizing(true);
    trackEvent('caption_capture_started', {
      surface,
      platform: Platform.OS,
      on_device: onDevice,
      language: languageRef.current,
    });
    return startRecognitionForRun(runId);
  }, [markUnavailable, reset, startRecognitionForRun, surface]);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    if (activeRef.current || recognizing) {
      stoppingRef.current = true;
      try {
        loadSpeechRecognitionModule()?.stop();
      } catch {
        // Best effort; the snapshot below still preserves captured interim text.
      }
      activeRef.current = false;
      stoppingRef.current = false;
      setRecognizing(false);
    }
    const next = snapshot();
    trackEvent(next.captions ? 'caption_capture_succeeded' : 'caption_capture_aborted', {
      surface,
      platform: Platform.OS,
      reason: next.captions ? 'transcript_ready' : unavailableReason ?? 'empty_transcript',
      language: next.language,
    });
    return next;
  }, [recognizing, snapshot, surface, unavailableReason]);

  const abort = useCallback(() => {
    runIdRef.current += 1;
    stoppingRef.current = true;
    activeRef.current = false;
    setRecognizing(false);
    try {
      loadSpeechRecognitionModule()?.abort();
    } catch {
      // Best effort only; abort is cleanup.
    }
  }, []);

  return {
    transcript,
    recognizing,
    unavailableReason,
    language: languageRef.current,
    start,
    stop,
    abort,
    reset,
    snapshot,
  };
}
