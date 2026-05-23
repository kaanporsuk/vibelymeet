import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach } from "node:test";
import { capture } from "./posthog.ts";

const originalDeno = (globalThis as { Deno?: unknown }).Deno;
const originalFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as { Deno?: unknown }).Deno = originalDeno;
  globalThis.fetch = originalFetch;
});

function setEdgeEnv(env: Record<string, string | undefined>) {
  (globalThis as { Deno?: { env: { get(name: string): string | undefined } } }).Deno = {
    env: {
      get: (name) => env[name],
    },
  };
}

test("server PostHog capture falls back to the EU host when POSTHOG_HOST is missing", async () => {
  setEdgeEnv({ POSTHOG_API_KEY: "test-key" });

  let capturedUrl = "";
  globalThis.fetch = async (input) => {
    capturedUrl = String(input);
    return new Response("{}", { status: 200 });
  };

  await capture({ event: "test_event", distinct_id: "test-user" });

  assert.equal(capturedUrl, "https://eu.i.posthog.com/capture/");
});

test("server PostHog capture honors explicit POSTHOG_HOST over the fallback", async () => {
  setEdgeEnv({
    POSTHOG_API_KEY: "test-key",
    POSTHOG_HOST: "https://posthog.example.test/custom/",
  });

  let capturedUrl = "";
  globalThis.fetch = async (input) => {
    capturedUrl = String(input);
    return new Response("{}", { status: 200 });
  };

  await capture({ event: "test_event", distinct_id: "test-user" });

  assert.equal(capturedUrl, "https://posthog.example.test/custom/capture/");
});

test("server PostHog helper contains no active US fallback", async () => {
  const source = await readFile(new URL("./posthog.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /https:\/\/us\.i\.posthog\.com/);
  assert.match(source, /https:\/\/eu\.i\.posthog\.com/);
});
