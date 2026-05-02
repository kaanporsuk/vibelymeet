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

test("production CSP allows first-party fonts, analytics assets, and CDN media", () => {
  assert.ok(directive("style-src").includes("https://fonts.googleapis.com"));
  assert.ok(directive("style-src").includes("https://onesignal.com"));
  assert.ok(directive("font-src").includes("https://fonts.gstatic.com"));
  assert.ok(directive("script-src").includes("https://eu-assets.i.posthog.com"));
  assert.ok(directive("script-src").includes("https://api.onesignal.com"));
  assert.ok(directive("script-src").includes("https://*.daily.co"));
  assert.ok(!directive("script-src").includes("'unsafe-eval'"));
  assert.ok(directive("connect-src").includes("https://eu-assets.i.posthog.com"));
  assert.ok(directive("connect-src").includes("https://*.daily.co"));
  assert.ok(directive("connect-src").includes("https://video.bunnycdn.com"));
  assert.ok(directive("frame-src").includes("https://*.daily.co"));
  assert.ok(directive("img-src").includes("https://cdn.vibelymeet.com"));
  assert.ok(directive("media-src").includes("https://cdn.vibelymeet.com"));
});
