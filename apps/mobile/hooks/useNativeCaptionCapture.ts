import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { getLocales } from 'expo-localization';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionResultEvent,
  type ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';
import { trackEvent } from '@/lib/analytics';
import type { MediaCaptions } from '../../../shared/media/captions';

type CaptionCaptureSurface =
  | 'native_chat_vibe_clip_recorder'
  | 'native_vibe_video_recorder';

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

  const startRecognitionForRun = useCallback((runId: number): boolean => {
    if (runIdRef.current !== runId || stoppingRef.current || !activeRef.current) return false;
    try {
      ExpoSpeechRecognitionModule.start({
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
        activeRef.current = false;
        setRecognizing(false);
        setUnavailableReason('recognition_start_failed');
        trackEvent('caption_capture_unavailable', {
          surface,
          platform: Platform.OS,
          reason: 'recognition_start_failed',
        });
      }
      return false;
    }
  }, [surface]);

  useSpeechRecognitionEvent('start', () => {
    if (!activeRef.current) return;
    setRecognizing(true);
  });

  useSpeechRecognitionEvent('end', () => {
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

  useSpeechRecognitionEvent('result', (event: ExpoSpeechRecognitionResultEvent) => {
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

  useSpeechRecognitionEvent('error', (event: ExpoSpeechRecognitionErrorEvent) => {
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

    const available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
    if (!available) {
      activeRef.current = false;
      setUnavailableReason('recognition_unavailable');
      trackEvent('caption_capture_unavailable', {
        surface,
        platform: Platform.OS,
        reason: 'recognition_unavailable',
      });
      return false;
    }

    let permissions;
    try {
      permissions = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    } catch {
      if (runIdRef.current === runId) {
        activeRef.current = false;
        setUnavailableReason('permission_request_failed');
        trackEvent('caption_capture_unavailable', {
          surface,
          platform: Platform.OS,
          reason: 'permission_request_failed',
        });
      }
      return false;
    }

    if (runIdRef.current !== runId || stoppingRef.current || !activeRef.current) {
      return false;
    }

    if (!permissions.granted) {
      activeRef.current = false;
      setUnavailableReason('permission_denied');
      trackEvent('caption_capture_unavailable', {
        surface,
        platform: Platform.OS,
        reason: 'permission_denied',
      });
      return false;
    }

    const onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    if (!onDevice) {
      activeRef.current = false;
      setRecognizing(false);
      setUnavailableReason('on_device_recognition_unavailable');
      trackEvent('caption_capture_unavailable', {
        surface,
        platform: Platform.OS,
        reason: 'on_device_recognition_unavailable',
      });
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
  }, [reset, startRecognitionForRun, surface]);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    if (activeRef.current || recognizing) {
      stoppingRef.current = true;
      try {
        ExpoSpeechRecognitionModule.stop();
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
      ExpoSpeechRecognitionModule.abort();
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
