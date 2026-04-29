import {
  emitVideoDateClientStuckObservability,
  type VideoDateClientStuckEventName,
  type VideoDateClientStuckPayload,
} from '@clientShared/observability/videoDateClientStuckObservability';
import { supabase } from '@/lib/supabase';

export function emitNativeVideoDateClientStuckState({
  sessionId,
  eventName,
  payload,
  latencyMs,
}: {
  sessionId: string | null | undefined;
  eventName: VideoDateClientStuckEventName;
  payload?: VideoDateClientStuckPayload | null;
  latencyMs?: number | null;
}) {
  return emitVideoDateClientStuckObservability({
    client: supabase,
    sessionId,
    eventName,
    payload: {
      platform: 'native',
      ...(payload ?? {}),
    },
    latencyMs,
  });
}
