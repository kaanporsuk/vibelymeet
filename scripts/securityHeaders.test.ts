import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  headers?: Array<{
    headers?: Array<{ key?: string; value?: string }>;
  }>;
};

function csp(): string {
  const header = vercel.headers
    ?.flatMap((entry) => entry.headers ?? [])
    .find((entry) => entry.key === "Content-Security-Policy");
  assert.ok(header?.value, "Content-Security-Policy header must exist");
  return header.value;
}

function directive(name: string): string[] {
  const match = csp()
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  assert.ok(match, `${name} directive must exist`);
  return match.split(/\s+/).slice(1);
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

test("production CSP allows first-party fonts, analytics assets, and CDN media", () => {
  assert.ok(directive("style-src").includes("https://fonts.googleapis.com"));
  assert.ok(directive("style-src").includes("https://onesignal.com"));
  assert.ok(directive("font-src").includes("https://fonts.gstatic.com"));
  assert.ok(directive("script-src").includes("https://eu-assets.i.posthog.com"));
  assert.ok(directive("script-src").includes("https://api.onesignal.com"));
  assert.ok(directive("script-src").includes("https://vibelyapp.daily.co"));
  assert.ok(directive("script-src").includes("https://c.daily.co"));
  assert.deepEqual(sorted(directive("script-src-elem")), sorted(directive("script-src")));
  assert.ok(directive("script-src-elem").includes("https://c.daily.co"));
  assert.ok(directive("script-src-elem").includes("https://vibelyapp.daily.co"));
  assert.ok(!directive("script-src").includes("https://*.daily.co"));
  assert.ok(!directive("script-src-elem").includes("https://*.daily.co"));
  assert.ok(!directive("script-src").includes("'unsafe-eval'"));
  assert.ok(!directive("script-src-elem").includes("'unsafe-eval'"));
  assert.ok(directive("connect-src").includes("https://eu-assets.i.posthog.com"));
  assert.ok(directive("connect-src").includes("wss://*.supabase.co"));
  assert.ok(directive("connect-src").includes("https://vibelyapp.daily.co"));
  assert.ok(directive("connect-src").includes("wss://vibelyapp.daily.co"));
  assert.ok(!directive("connect-src").includes("https://*.daily.co"));
  assert.ok(!directive("connect-src").includes("wss://*.daily.co"));
  assert.ok(directive("connect-src").includes("https://video.bunnycdn.com"));
  assert.ok(directive("frame-src").includes("https://vibelyapp.daily.co"));
  assert.ok(!directive("frame-src").includes("https://*.daily.co"));
  assert.ok(directive("img-src").includes("https://cdn.vibelymeet.com"));
  assert.ok(directive("media-src").includes("https://cdn.vibelymeet.com"));
});
