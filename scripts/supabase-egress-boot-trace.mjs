import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SECRET_PARAM_RE = /(authorization|apikey|api_key|access_token|refresh_token|jwt|secret|password|otp|code|signed|signature|cookie|session)/i;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const DEFAULT_BASE_URL = "https://www.vibelymeet.com";
const DEFAULT_WAIT_MS = 12_000;

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const env = {
  ...parseEnvFile(".env.local"),
  ...parseEnvFile(".env.cursor.local"),
  ...process.env,
};

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY;
const bunnyHost = (env.VITE_BUNNY_CDN_HOSTNAME ?? "").replace(/^https?:\/\//i, "").replace(/^\/+|\/+$/g, "");
const baseUrl = normalizeBaseUrl(env.BOOT_TRACE_BASE_URL ?? env.APP_URL ?? DEFAULT_BASE_URL);
const waitMs = Number.parseInt(env.BOOT_TRACE_WAIT_MS ?? String(DEFAULT_WAIT_MS), 10);
const artifactDir = env.BOOT_TRACE_ARTIFACT_DIR ?? "artifacts/supabase-egress-traces";
const routePath = env.BOOT_TRACE_ROUTE ?? "/home";

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY");
}

const supabaseHost = new URL(supabaseUrl).hostname.toLowerCase();
const projectRef = supabaseHost.split(".")[0];
const storageKey = `sb-${projectRef}-auth-token`;

function normalizeBaseUrl(raw) {
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/g, "");
}

function isSupabaseHost(hostname) {
  const host = hostname.toLowerCase();
  return host === supabaseHost || /\.supabase\.(?:co|in)$/i.test(host);
}

function isBunnyHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    (bunnyHost && host === bunnyHost.toLowerCase()) ||
    /(?:^|\.)b-cdn\.net$/.test(host) ||
    /(?:^|\.)bunnycdn\.com$/.test(host)
  );
}

function classifyTraffic(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname;
  if (isBunnyHost(parsed.hostname)) return "Media/CDN";
  if (!isSupabaseHost(parsed.hostname)) return null;
  if (path.startsWith("/rest/v1/rpc/")) return "RPC";
  if (path.startsWith("/rest/v1/")) return "Database/PostgREST";
  if (path.startsWith("/auth/v1/")) return "Auth";
  if (path.startsWith("/functions/v1/")) return "Edge Functions";
  if (path.startsWith("/realtime/v1/")) return "Realtime";
  if (path.startsWith("/storage/v1/")) return "Storage";
  return "Other";
}

function normalizedPath(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname.replace(UUID_RE, ":uuid");
  const params = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (SECRET_PARAM_RE.test(key)) {
      params.push(`${key}=[redacted]`);
    } else if (key === "select") {
      params.push(`${key}=${truncate(value.replace(/\s+/g, " "), 220)}`);
    } else if (["count", "grant_type", "head", "limit", "offset", "order"].includes(key)) {
      params.push(`${key}=${truncate(value, 80)}`);
    } else {
      params.push(`${key}=[filtered]`);
    }
  }
  params.sort();
  return params.length ? `${pathname}?${params.join("&")}` : pathname;
}

function truncate(value, max) {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function emptyBucket() {
  return {
    count: 0,
    errorCount: 0,
    estimatedBytes: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    statusCounts: {},
  };
}

function addToBucket(bucket, event) {
  bucket.count += 1;
  if (event.status == null || event.status >= 400) bucket.errorCount += 1;
  bucket.estimatedBytes += event.estimatedBytes;
  bucket.totalDurationMs += event.durationMs;
  bucket.maxDurationMs = Math.max(bucket.maxDurationMs, event.durationMs);
  const statusKey = event.status == null ? "failed" : String(event.status);
  bucket.statusCounts[statusKey] = (bucket.statusCounts[statusKey] ?? 0) + 1;
}

function createRecorder() {
  const bySurface = new Map();
  const byPath = new Map();
  const requests = [];

  function record(event) {
    requests.push(event);
    const surfaceBucket = bySurface.get(event.surface) ?? emptyBucket();
    addToBucket(surfaceBucket, event);
    bySurface.set(event.surface, surfaceBucket);

    const key = `${event.surface}|${event.method}|${event.path}`;
    const pathBucket = byPath.get(key) ?? {
      ...emptyBucket(),
      method: event.method,
      path: event.path,
      surface: event.surface,
    };
    addToBucket(pathBucket, event);
    byPath.set(key, pathBucket);
  }

  function snapshot() {
    const requestsBySurface = Object.fromEntries(
      Array.from(bySurface.entries()).sort(([a], [b]) => a.localeCompare(b)),
    );
    const topPaths = Array.from(byPath.values())
      .sort((a, b) => b.count - a.count || b.estimatedBytes - a.estimatedBytes)
      .map((bucket) => ({
        ...bucket,
        avgDurationMs: bucket.count ? Math.round(bucket.totalDurationMs / bucket.count) : 0,
      }));
    return {
      requestCount: requests.length,
      estimatedBytes: requests.reduce((sum, event) => sum + event.estimatedBytes, 0),
      healthCallCount: requests.filter((event) => event.surface === "Edge Functions" && event.path.startsWith("/functions/v1/health")).length,
      realtimeOpenCount: requests.filter((event) => event.surface === "Realtime").length,
      requestsBySurface,
      topPaths,
    };
  }

  return { record, snapshot };
}

async function loginSmokeUser() {
  const email = env.SMOKE_PROOF_PRIMARY_EMAIL;
  const password = env.SMOKE_PROOF_PRIMARY_PASSWORD;
  if (!email || !password) {
    throw new Error("Missing SMOKE_PROOF_PRIMARY_EMAIL or SMOKE_PROOF_PRIMARY_PASSWORD in .env.cursor.local");
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token || !body?.refresh_token || !body?.user) {
    throw new Error(`Smoke auth failed with status ${response.status}`);
  }
  return body;
}

async function traceBoot(browser, label, { session = null } = {}) {
  const recorder = createRecorder();
  const pending = new Map();
  const context = await browser.newContext();
  if (session) {
    await context.addInitScript(
      ({ storageKey, session }) => {
        window.localStorage.setItem(storageKey, JSON.stringify(session));
      },
      { storageKey, session },
    );
  }

  const page = await context.newPage();
  page.on("request", (request) => {
    const surface = classifyTraffic(request.url());
    if (!surface) return;
    pending.set(request, {
      startedAtMs: Date.now(),
      surface,
      method: request.method(),
      url: request.url(),
      path: normalizedPath(request.url()),
    });
  });
  page.on("response", async (response) => {
    const request = response.request();
    const pendingRequest = pending.get(request);
    const surface = pendingRequest?.surface ?? classifyTraffic(response.url());
    if (!surface) return;
    pending.delete(request);
    const startedAtMs = pendingRequest?.startedAtMs ?? Date.now();
    const headerLength = Number(response.headers()["content-length"]);
    let estimatedBytes = Number.isFinite(headerLength) && headerLength >= 0 ? headerLength : 0;
    try {
      const body = await response.body();
      estimatedBytes = body.length;
    } catch {
      // Streaming/websocket/preflight bodies are not always readable from Playwright.
    }
    recorder.record({
      surface,
      method: pendingRequest?.method ?? request.method(),
      path: pendingRequest?.path ?? normalizedPath(response.url()),
      status: response.status(),
      durationMs: Math.max(0, Date.now() - startedAtMs),
      estimatedBytes,
    });
  });
  page.on("requestfailed", (request) => {
    const pendingRequest = pending.get(request);
    const surface = pendingRequest?.surface ?? classifyTraffic(request.url());
    if (!surface) return;
    pending.delete(request);
    recorder.record({
      surface,
      method: pendingRequest?.method ?? request.method(),
      path: pendingRequest?.path ?? normalizedPath(request.url()),
      status: null,
      durationMs: Math.max(0, Date.now() - (pendingRequest?.startedAtMs ?? Date.now())),
      estimatedBytes: 0,
    });
  });
  page.on("websocket", (ws) => {
    const surface = classifyTraffic(ws.url());
    if (surface !== "Realtime") return;
    recorder.record({
      surface,
      method: "WS",
      path: normalizedPath(ws.url()),
      status: 101,
      durationMs: 0,
      estimatedBytes: 0,
    });
  });

  const url = `${baseUrl}${routePath.startsWith("/") ? routePath : `/${routePath}`}`;
  let navigationError = null;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }
  await page.waitForTimeout(Number.isFinite(waitMs) ? waitMs : DEFAULT_WAIT_MS);
  const bootDiagnostics = await page
    .evaluate(() => window.__vibelyBootDiagnostics ?? null)
    .catch(() => null);
  const finalUrl = page.url();
  await context.close();

  return {
    label,
    route: routePath,
    finalUrl,
    navigationError,
    bootDiagnostics,
    ...recorder.snapshot(),
  };
}

const browser = await chromium.launch({ headless: true });
try {
  const authenticatedSession = await loginSmokeUser();
  const traces = [
    await traceBoot(browser, "anonymous-home"),
    await traceBoot(browser, "authenticated-home", { session: authenticatedSession }),
  ];
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    route: routePath,
    waitMs: Number.isFinite(waitMs) ? waitMs : DEFAULT_WAIT_MS,
    projectRef,
    surfaces: ["Database/PostgREST", "RPC", "Auth", "Edge Functions", "Realtime", "Storage", "Media/CDN", "Other"],
    traces,
  };

  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(
    artifactDir,
    `boot-trace-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ artifactPath, ...report }, null, 2));
} finally {
  await browser.close();
}
