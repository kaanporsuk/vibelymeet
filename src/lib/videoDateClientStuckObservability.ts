import {
  emitVideoDateClientStuckObservability,
  type VideoDateClientStuckEventName,
  type VideoDateClientStuckPayload,
} from "@clientShared/observability/videoDateClientStuckObservability";
import { supabase } from "@/integrations/supabase/client";

export function emitWebVideoDateClientStuckState({
  sessionId,
  eventName,
  payload,
  latencyMs,
  dedupe,
}: {
  sessionId: string | null | undefined;
  eventName: VideoDateClientStuckEventName;
  payload?: VideoDateClientStuckPayload | null;
  latencyMs?: number | null;
  dedupe?: boolean;
}) {
  return emitVideoDateClientStuckObservability({
    client: supabase,
    sessionId,
    eventName,
    payload: {
      platform: "web",
      ...(payload ?? {}),
    },
    latencyMs,
    dedupe,
  });
}
