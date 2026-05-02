import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("event checkout is server-priced and gender-neutral", () => {
  const checkout = read("supabase/functions/create-event-checkout/index.ts");

  assert.match(checkout, /eventId/);
  assert.match(checkout, /price_amount/);
  assert.match(checkout, /price_currency/);
  assert.match(checkout, /stripe_event_ticket_checkout_intents/);
  assert.doesNotMatch(checkout, /\bprice\b\s*=|body\.price|body\.currency|eventTitle|profile.*gender|gender.*profile/i);
  assert.doesNotMatch(checkout, /female|woman|women|male|discount/i);
});

test("event webhook verifies checkout intent amount and currency before settlement", () => {
  const webhook = read("supabase/functions/stripe-webhook/index.ts");

  const verifyIndex = webhook.indexOf("verify_event_ticket_checkout_intent");
  const settleIndex = webhook.indexOf("settle_event_ticket_checkout");
  assert.ok(verifyIndex > 0, "webhook should verify checkout intent");
  assert.ok(settleIndex > verifyIndex, "settlement should happen after amount/currency verification");
  assert.match(webhook, /No stripe signature[\s\S]*status: 400/);
  assert.match(webhook, /Webhook signature verification failed[\s\S]*status: 400/);
});

test("web and native event pricing surfaces no longer expose gender-specific prices", () => {
  const files = [
    "src/pages/EventDetails.tsx",
    "src/components/events/PaymentModal.tsx",
    "src/components/events/PricingBar.tsx",
    "src/pages/AdminCreateEvent.tsx",
    "apps/mobile/app/(tabs)/events/[id].tsx",
    "apps/mobile/components/events/PricingBar.tsx",
  ];

  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /priceMale|priceFemale|priceMen|priceWomen|userGender|genderLabel/i, file);
    assert.doesNotMatch(source, /Ticket price for (Female|Male)|Price for Women|Price for Men|gender ratio|discount/i, file);
  }
});

test("analytics vendors are mounted only after explicit consent", () => {
  const app = read("src/App.tsx");
  const main = read("src/main.tsx");
  const nativeLayout = read("apps/mobile/app/_layout.tsx");

  assert.match(app, /analyticsConsent === "granted"/);
  assert.match(app, /analyticsAllowed \? \(/);
  assert.doesNotMatch(main, /replayIntegration|replaysOnErrorSampleRate/);
  assert.match(nativeLayout, /POSTHOG_ENABLED && analyticsConsentGranted/);
});

test("chat media writes private refs and renders through authorized resolver", () => {
  const sendMessage = read("supabase/functions/send-message/index.ts");
  const resolver = read("supabase/functions/get-chat-media-url/index.ts");
  const webOutbox = read("src/lib/webChatOutbox/execute.ts");
  const nativeOutbox = read("apps/mobile/lib/chatOutbox/execute.ts");
  const webMessages = read("src/hooks/useMessages.ts");
  const nativeMessages = read("apps/mobile/lib/chatApi.ts");

  assert.match(sendMessage, /mediaRefHasStorageSegment/);
  assert.doesNotMatch(sendMessage, /publicUrlHasStorageSegment/);
  assert.match(resolver, /type MediaKind = "image" \| "voice" \| "video" \| "vibe_clip" \| "thumbnail"/);
  assert.match(resolver, /\.from\("media_assets"\)/);
  assert.doesNotMatch(resolver, /ref_type", "message_attachment"/);
  assert.match(webOutbox, /formatChatImageMessageContent\(mediaRef\)/);
  assert.doesNotMatch(webOutbox, /getImageUrl\(path/);
  assert.match(nativeOutbox, /formatChatImageMessageContent\(mediaRef\)/);
  assert.match(webMessages, /resolveChatMessageMediaForDisplay/);
  assert.match(nativeMessages, /resolveChatMessageMediaForDisplay/);
});
