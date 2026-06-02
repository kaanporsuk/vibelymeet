import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const doc = readFileSync(join(process.cwd(), "docs/video-date-provider-runtime-scope.md"), "utf8");

test("Video Date runtime provider scope separates direct date providers from adjacent journey systems", () => {
  assert.match(doc, /The direct Video Date runtime exchanges are Supabase, Daily, OneSignal, Sentry, and PostHog\./);
  assert.match(doc, /Stripe, RevenueCat, Twilio, Resend, and Bunny are adjacent app systems/);
  assert.match(doc, /not direct `\/date\/:id` runtime providers/);
  assert.match(doc, /do not count them as direct Video Date runtime exchanges/);
});

test("direct and adjacent provider sets stay complete and non-overlapping in the scope note", () => {
  const directProviders = ["Supabase", "Daily", "OneSignal", "Sentry", "PostHog"];
  const adjacentProviders = ["Stripe", "RevenueCat", "Twilio", "Resend", "Bunny"];

  const directSection = doc.split("## Adjacent Journey Providers")[0] ?? "";
  const adjacentSection = doc.split("## Adjacent Journey Providers")[1] ?? "";

  for (const provider of directProviders) {
    assert.match(directSection, new RegExp(`\\b${provider}\\b`));
  }

  for (const provider of adjacentProviders) {
    assert.doesNotMatch(directSection, new RegExp(`\\b${provider}\\b`));
    assert.match(adjacentSection, new RegExp(`\\b${provider}\\b`));
  }
});
