import { supabase } from "@/integrations/supabase/client";

// Golden-flow lean pass: ReadyGateOverlay, useReadyGate, and VideoDate each
// fetched the partner profile independently on every mount/effect re-run —
// ~15 get_profile_for_viewer RPCs per launch for the same partner (it is the
// #1 cumulative DB consumer). Partner display data is stable for the length
// of a date, so video-date surfaces share one in-flight request and a short
// TTL memo per partner. Errors are never cached.

const PARTNER_PROFILE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 16;

export type VideoDatePartnerProfileResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

const cache = new Map<string, { at: number; data: unknown }>();
const inFlight = new Map<string, Promise<VideoDatePartnerProfileResult>>();

function getVideoDatePartnerProfileCacheKey(viewerId: string | null, partnerId: string): string {
  return `${viewerId ?? "anonymous"}:${partnerId}`;
}

function pruneCache(now: number): void {
  for (const [key, entry] of cache) {
    if (now - entry.at > PARTNER_PROFILE_TTL_MS) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export async function fetchVideoDatePartnerProfile(
  partnerId: string,
): Promise<VideoDatePartnerProfileResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const cacheKey = getVideoDatePartnerProfileCacheKey(session?.user?.id ?? null, partnerId);
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.at <= PARTNER_PROFILE_TTL_MS) {
    return { data: cached.data, error: null };
  }

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const request = (async (): Promise<VideoDatePartnerProfileResult> => {
    try {
      const { data, error } = await supabase.rpc("get_profile_for_viewer", {
        p_target_id: partnerId,
      });
      if (error) {
        return { data: null, error: { code: error.code ?? undefined, message: error.message } };
      }
      cache.set(cacheKey, { at: Date.now(), data });
      pruneCache(Date.now());
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  })();

  inFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
  }
}

export function clearVideoDatePartnerProfileCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
