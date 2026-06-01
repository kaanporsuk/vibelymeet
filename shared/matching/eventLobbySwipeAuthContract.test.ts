import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const webSwipe = read("src/hooks/useSwipeAction.ts");
const nativeEventsApi = read("apps/mobile/lib/eventsApi.ts");
const nativeAuthSession = read("apps/mobile/lib/nativeAuthSession.ts");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");
const supabaseConfig = read("supabase/config.toml");

const CLIENT_SCAN_IGNORED_DIRS = new Set([
  ".expo",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

function clientSourceFiles(dir: string): string[] {
  const absoluteDir = join(root, dir);
  return readdirSync(absoluteDir).flatMap((entry) => {
    if (CLIENT_SCAN_IGNORED_DIRS.has(entry)) return [];
    const relativePath = join(dir, entry);
    const absolutePath = join(root, relativePath);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) return clientSourceFiles(relativePath);
    return /\.(tsx?|jsx?)$/.test(entry) ? [relativePath] : [];
  });
}

function readClientSources(): string {
  return clientSourceFiles("src")
    .concat(clientSourceFiles("apps/mobile"))
    .map((path) => `\n// ${path}\n${read(path)}`)
    .join("\n");
}

test("swipe-actions keeps strict Supabase gateway JWT verification", () => {
  const block = supabaseConfig.match(/\[functions\.swipe-actions\]\nverify_jwt = true/);
  assert.ok(block, "swipe-actions must remain verify_jwt = true");
});

test("web swipe posts to swipe-actions with an explicit user JWT", () => {
  assert.match(webSwipe, /useAuth\(\)/);
  assert.match(webSwipe, /resolveWebSwipeAccessToken\(session\)/);
  assert.match(webSwipe, /requestManagedAuthRefresh/);
  assert.match(webSwipe, /applyManagedAuthRefreshSession\(supabase\.auth, activeSession, refreshResponse\)/);
  assert.doesNotMatch(webSwipe, /supabase\.auth\.refreshSession\(activeSession\)/);
  assert.match(webSwipe, /fetch\(swipeActionsUrl/);
  assert.match(webSwipe, /functions\/v1\/swipe-actions/);
  assert.match(webSwipe, /Authorization:\s*`Bearer \$\{accessToken\}`/);
  assert.match(webSwipe, /apikey:\s*SUPABASE_PUBLISHABLE_KEY/);
  assert.match(webSwipe, /deck_token:\s*deckToken \?\? null/);
  assert.match(webSwipe, /result:\s*"unauthorized"/);
  assert.doesNotMatch(webSwipe, /functions\.invoke\(["']swipe-actions["']/);
  assert.doesNotMatch(webSwipe, /\.rpc\(["']handle_swipe["']/);
});

test("native swipe posts to swipe-actions with an explicit fresh user JWT", () => {
  assert.match(nativeEventsApi, /getFreshCachedAccessToken/);
  assert.match(nativeEventsApi, /fetch\(swipeActionsUrl/);
  assert.match(nativeEventsApi, /functions\/v1\/swipe-actions/);
  assert.match(nativeEventsApi, /Authorization:\s*`Bearer \$\{accessToken\}`/);
  assert.match(nativeEventsApi, /apikey:\s*SUPABASE_PUBLISHABLE_KEY/);
  assert.match(nativeEventsApi, /deck_token:\s*deckToken \?\? null/);
  assert.match(nativeEventsApi, /result:\s*'unauthorized'/);
  assert.doesNotMatch(nativeEventsApi, /functions\.invoke\(['"]swipe-actions['"]/);
  assert.doesNotMatch(nativeEventsApi, /\.rpc\(['"]handle_swipe['"]/);
});

test("swipe-actions routes token-aware swipes through handle_swipe_v2", () => {
  assert.match(swipeActions, /const \{ event_id, target_id, swipe_type, deck_token \} = await req\.json\(\)/);
  assert.match(swipeActions, /const normalizedDeckToken = typeof deck_token === "string"/);
  assert.match(swipeActions, /userClient\.rpc\("handle_swipe_v2"/);
  assert.match(swipeActions, /p_deck_token:\s*normalizedDeckToken/);
});

test("native auth helper refreshes near-expiry swipe tokens without bypassing the cache", () => {
  assert.match(nativeAuthSession, /SWIPE_AUTH_REFRESH_WINDOW_MS = 60_000/);
  assert.match(nativeAuthSession, /refreshInFlight/);
  assert.match(nativeAuthSession, /cacheVersion/);
  assert.match(nativeAuthSession, /cacheVersion !== requestVersion/);
  assert.match(nativeAuthSession, /requestManagedAuthRefresh/);
  assert.match(nativeAuthSession, /applyManagedAuthRefreshSession\(supabase\.auth, session, refreshResponse,/);
  assert.doesNotMatch(nativeAuthSession, /supabase\.auth\.refreshSession\(session\)/);
  assert.match(nativeAuthSession, /export async function getFreshCachedAccessToken/);
});

test("client code cannot reintroduce bare swipe-actions invoke or direct handle_swipe RPC", () => {
  const clientSources = readClientSources();
  assert.doesNotMatch(clientSources, /functions\.invoke\(["']swipe-actions["']/);
  assert.doesNotMatch(clientSources, /\.rpc\(["']handle_swipe["']/);
});
