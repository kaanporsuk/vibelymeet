// Lightweight server-side PostHog capture for Edge Functions.
//
// Reads POSTHOG_API_KEY (server token) and optional POSTHOG_HOST (defaults to
// us.i.posthog.com). Fire-and-forget: failures are logged but never thrown so
// they cannot break the calling pipeline.

const DEFAULT_HOST = "https://us.i.posthog.com";

function getEnv(name: string): string | undefined {
  const denoEnv = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  if (denoEnv) return denoEnv.get(name);
  const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return nodeProcess?.env?.[name];
}

export type PosthogEvent = {
  event: string;
  distinct_id: string;
  properties?: Record<string, unknown>;
};

export async function capture(event: PosthogEvent): Promise<void> {
  const key = getEnv("POSTHOG_API_KEY");
  if (!key) return;
  const host = getEnv("POSTHOG_HOST") || DEFAULT_HOST;

  try {
    const res = await fetch(`${host.replace(/\/$/, "")}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: event.event,
        distinct_id: event.distinct_id,
        properties: {
          $lib: "vibely-edge-functions",
          ...event.properties,
        },
        timestamp: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      console.warn("[posthog] capture non-2xx", res.status, event.event);
    }
  } catch (err) {
    console.warn("[posthog] capture failed", event.event, (err as Error).message);
  }
}
