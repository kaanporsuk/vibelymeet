import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hasStaleBundleReloadAlreadyAttempted,
  isLikelyStaleBundleError,
  recordBrowserEvent,
  sanitizeBrowserDiagnosticPayload,
  sanitizeDiagnosticText,
  sanitizeDiagnosticUrl,
} from "../src/lib/browserDiagnostics";

const browserDiagnosticsSource = readFileSync(join(process.cwd(), "src/lib/browserDiagnostics.ts"), "utf8");
const uuid = "27b4b3bd-d441-4903-88a5-e25cf7acfa96";

assert.equal(sanitizeDiagnosticUrl(`https://www.vibelymeet.com/chat/${uuid}?access_token=secret#frag`), "/chat/:uuid#[hash]");
assert.equal(
  sanitizeDiagnosticUrl("https://vz-123.b-cdn.net/library/video/playlist.m3u8?token=secret"),
  "[redacted-media-url]",
);
assert.equal(
  sanitizeBrowserDiagnosticPayload({
    asset: "https://vz-123.b-cdn.net/library/raw-stream",
  }).asset,
  "[redacted-media-url]",
);
assert.equal(sanitizeDiagnosticText("failed with access_token=secret-value"), "failed with access_token=[redacted]");

const sanitized = sanitizeBrowserDiagnosticPayload({
  route: `/date/${uuid}?token=secret`,
  Authorization: "Bearer super-secret-token",
  body: "private message contents",
  sender_name: "Kaan",
  href: `https://www.vibelymeet.com/events/${uuid}?checkout=secret`,
  nested: {
    onesignal_player_id: "player-raw-value",
    email: "person@example.com",
    error_message: "failed for user person@example.com",
    detail: `session ${uuid}`,
  },
});

assert.equal(sanitized.route, "/date/:uuid");
assert.equal(sanitized.Authorization, "[redacted]");
assert.equal(sanitized.body, "[redacted]");
assert.equal(sanitized.sender_name, "[redacted]");
assert.equal(sanitized.href, "/events/:uuid");
assert.deepEqual(sanitized.nested, {
  onesignal_player_id: "[redacted]",
  email: "[redacted]",
  error_message: "failed for user [redacted-email]",
  detail: "session [uuid]",
});

const largePayload = sanitizeBrowserDiagnosticPayload({
  safe: "x".repeat(20_000),
});
assert.equal(typeof largePayload.safe, "string");
assert.ok(String(largePayload.safe).length < 300);

const manyKeys = sanitizeBrowserDiagnosticPayload(
  Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`key_${index}`, index])),
);
assert.ok(Object.keys(manyKeys).length <= 30);

assert.equal(recordBrowserEvent("not.allowed.event", { ok: true }), false);

assert.match(browserDiagnosticsSource, /BOOT_SUMMARY_DELAY_MS\s*=\s*12_000/);
assert.match(browserDiagnosticsSource, /window\.__vibelyBootDiagnostics/);
assert.match(browserDiagnosticsSource, /requestsBySurface/);
assert.match(browserDiagnosticsSource, /fetchHealthWithOnePerBootCap/);
assert.match(browserDiagnosticsSource, /browser\.health_check_capped/);
assert.match(browserDiagnosticsSource, /cachedHealthResponse/);
assert.match(browserDiagnosticsSource, /function failedHealthResponseSnapshot/);
assert.match(browserDiagnosticsSource, /headers\.delete\("content-encoding"\)/);
assert.match(browserDiagnosticsSource, /headers\.delete\("content-length"\)/);
assert.match(browserDiagnosticsSource, /TRAFFIC_QUERY_VALUE_ALLOWLIST/);
assert.match(browserDiagnosticsSource, /function sanitizeTrafficPath/);
assert.match(browserDiagnosticsSource, /function normalizeStorageTrafficPath/);
assert.match(browserDiagnosticsSource, /key === "select"/);
assert.match(browserDiagnosticsSource, /\[filtered\]/);
assert.match(browserDiagnosticsSource, /instrumentSupabaseRealtimeDiagnostics/);
assert.match(browserDiagnosticsSource, /pruneDuplicateRealtimeChannels/);
assert.match(browserDiagnosticsSource, /seenFromNewest/);
assert.match(browserDiagnosticsSource, /removeAllRealtimeChannels/);
for (const surface of [
  "Database/PostgREST",
  "RPC",
  "Auth",
  "Edge Functions",
  "Realtime",
  "Storage",
  "Media/CDN",
]) {
  assert.match(browserDiagnosticsSource, new RegExp(surface.replace(/[/.]/g, "\\$&")));
}

assert.equal(
  isLikelyStaleBundleError(new TypeError("Failed to fetch dynamically imported module: https://www.vibelymeet.com/assets/EventLobby-Ro3so-7k.js")),
  true,
);
assert.equal(
  isLikelyStaleBundleError(
    'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
  ),
  true,
);
assert.equal(isLikelyStaleBundleError(Object.assign(new Error("Loading chunk EventLobby failed."), { name: "ChunkLoadError" })), true);
assert.equal(isLikelyStaleBundleError(new Error("Unable to preload CSS for /assets/index-B-MxQWnZ.css")), true);
assert.equal(isLikelyStaleBundleError(new Error("ordinary component render failure")), false);

const previousWindow = (globalThis as { window?: unknown }).window;
(globalThis as { window?: unknown }).window = {
  name: "vibely_stale_bundle_reload:%2Fassets%2Findex-Test.js",
  sessionStorage: {
    getItem() {
      throw new Error("storage unavailable");
    },
  },
};
assert.equal(hasStaleBundleReloadAlreadyAttempted("/assets/index-Test.js"), true);
assert.equal(hasStaleBundleReloadAlreadyAttempted("/assets/index-Other.js"), false);
(globalThis as { window?: unknown }).window = previousWindow;

console.log("browser diagnostics sanitization tests passed");
