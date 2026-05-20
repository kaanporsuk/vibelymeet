// check-bunny-cdn-health: cron-invoked synthetic monitor for Bunny Stream and
// Bunny Storage delivery. Emits PostHog every run and alerts Sentry after three
// consecutive failures for a probe.
//
// Auth: Bearer CRON_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import * as Sentry from "https://deno.land/x/sentry@8.55.0/index.mjs";
import { capture } from "../_shared/posthog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ProbeName = "stream_hls" | "storage_object";

type ProbeResult = {
  probe: ProbeName;
  configured: boolean;
  ok: boolean;
  urlConfigured: boolean;
  httpStatus: number | null;
  latencyMs: number;
  contentType: string | null;
  error: string | null;
};

type HealthStateRow = {
  probe: string;
  consecutive_failures: number | null;
  alerted_at: string | null;
};

let sentryInitialized = false;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function redactedProbeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return "invalid_url";
  }
}

async function probeUrl(
  probe: ProbeName,
  url: string | undefined,
  expectedContentType?: RegExp,
): Promise<ProbeResult> {
  const startedAt = performance.now();
  if (!url?.trim()) {
    return {
      probe,
      configured: false,
      ok: false,
      urlConfigured: false,
      httpStatus: null,
      latencyMs: 0,
      contentType: null,
      error: "probe_url_missing",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    const contentType = res.headers.get("Content-Type");
    const ok = res.ok && (!expectedContentType || expectedContentType.test(contentType ?? ""));
    return {
      probe,
      configured: true,
      ok,
      urlConfigured: true,
      httpStatus: res.status,
      latencyMs: Math.round(performance.now() - startedAt),
      contentType,
      error: ok ? null : expectedContentType && !expectedContentType.test(contentType ?? "")
        ? "unexpected_content_type"
        : `http_${res.status}`,
    };
  } catch (err) {
    return {
      probe,
      configured: true,
      ok: false,
      urlConfigured: true,
      httpStatus: null,
      latencyMs: Math.round(performance.now() - startedAt),
      contentType: null,
      error: String(err).slice(0, 300),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function captureSentryAlert(result: ProbeResult, consecutiveFailures: number) {
  const dsn = Deno.env.get("SENTRY_DSN")?.trim();
  if (!dsn) return;
  try {
    if (!sentryInitialized) {
      Sentry.init({ dsn, tracesSampleRate: 0 });
      sentryInitialized = true;
    }
    Sentry.captureMessage("bunny_cdn_health_probe_failed", {
      level: "error",
      tags: {
        function: "check-bunny-cdn-health",
        probe: result.probe,
      },
      extra: {
        consecutive_failures: consecutiveFailures,
        http_status: result.httpStatus,
        latency_ms: result.latencyMs,
        content_type: result.contentType,
        error: result.error,
      },
    });
    void Sentry.flush(1000).catch(() => {});
  } catch {
    // Monitoring must not break the monitor.
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const incoming = req.headers.get("Authorization");
  if (!cronSecret || incoming !== `Bearer ${cronSecret}`) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const results = await Promise.all([
    probeUrl(
      "stream_hls",
      Deno.env.get("BUNNY_CDN_HEALTH_STREAM_URL"),
      /(?:application\/vnd\.apple\.mpegurl|mpegurl|x-mpegurl|octet-stream)/i,
    ),
    probeUrl("storage_object", Deno.env.get("BUNNY_CDN_HEALTH_STORAGE_URL")),
  ]);

  const stateUpdates = [];
  for (const result of results) {
    const { data: previousRow } = await supabase
      .from("bunny_cdn_health_state")
      .select("probe, consecutive_failures, alerted_at")
      .eq("probe", result.probe)
      .maybeSingle();
    const previous = previousRow as HealthStateRow | null;
    const previousFailures = Number(previous?.consecutive_failures ?? 0);
    const consecutiveFailures = result.ok ? 0 : previousFailures + 1;
    const shouldAlert = !result.ok && consecutiveFailures >= 3 && previousFailures < 3;
    const alertedAt = shouldAlert ? new Date().toISOString() : previous?.alerted_at ?? null;

    const { error: upsertError } = await supabase
      .from("bunny_cdn_health_state")
      .upsert({
        probe: result.probe,
        consecutive_failures: consecutiveFailures,
        last_status: result.ok ? "ok" : "failed",
        last_checked_at: new Date().toISOString(),
        last_error: result.error,
        last_http_status: result.httpStatus,
        alerted_at: result.ok ? null : alertedAt,
      }, { onConflict: "probe" });

    void capture({
      event: "bunny_cdn_health",
      distinct_id: result.probe,
      properties: {
        feature: "media-sdk",
        function: "check-bunny-cdn-health",
        probe: result.probe,
        ok: result.ok,
        configured: result.configured,
        http_status: result.httpStatus,
        latency_ms: result.latencyMs,
        content_type: result.contentType,
        consecutive_failures: consecutiveFailures,
        error: result.error,
        probe_url: result.configured
          ? redactedProbeUrl(result.probe === "stream_hls"
            ? Deno.env.get("BUNNY_CDN_HEALTH_STREAM_URL") ?? ""
            : Deno.env.get("BUNNY_CDN_HEALTH_STORAGE_URL") ?? "")
          : null,
      },
    });

    if (shouldAlert) captureSentryAlert(result, consecutiveFailures);
    stateUpdates.push({
      probe: result.probe,
      ok: result.ok,
      consecutive_failures: consecutiveFailures,
      alert_sent: shouldAlert,
      state_update_error: upsertError?.message ?? null,
    });
  }

  const healthy = results.every((result) => result.ok);
  return jsonResponse({
    success: true,
    healthy,
    probes: results,
    state: stateUpdates,
  }, healthy ? 200 : 503);
});
