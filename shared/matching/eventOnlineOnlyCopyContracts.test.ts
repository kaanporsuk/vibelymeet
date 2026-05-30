import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const publicEventSurfaceFiles = [
  "src/components/EventCard.tsx",
  "src/components/events/CancelRegistrationModal.tsx",
  "src/components/events/EventCardPremium.tsx",
  "src/components/events/FeaturedEventCard.tsx",
  "src/components/events/GuestListRoster.tsx",
  "src/components/events/GuestListTeaser.tsx",
  "src/components/events/ManageRegistrationModal.tsx",
  "src/components/events/PaymentModal.tsx",
  "src/components/events/PricingBar.tsx",
  "src/components/events/RegistrationStub.tsx",
  "src/components/events/VenueCard.tsx",
  "src/hooks/useEventDetails.ts",
  "src/lib/supportCategories.ts",
  "src/pages/EventDetails.tsx",
  "src/pages/EventLobby.tsx",
  "src/pages/EventPaymentSuccess.tsx",
  "src/pages/legal/TermsOfService.tsx",
  "apps/mobile/app/(tabs)/events/[id].tsx",
  "apps/mobile/app/(tabs)/events/index.tsx",
  "apps/mobile/app/event/[eventId]/lobby.tsx",
  "apps/mobile/app/event-payment-success.tsx",
  "apps/mobile/components/events/ManageRegistrationModal.tsx",
  "apps/mobile/components/events/PricingBar.tsx",
  "apps/mobile/components/events/RegistrationStub.tsx",
  "apps/mobile/components/events/VenueCard.tsx",
  "apps/mobile/components/events/WhosGoingSection.tsx",
  "apps/mobile/lib/eventsApi.ts",
  "apps/mobile/lib/supportCategories.ts",
  "shared/matching/videoDatePublicApi.ts",
  "supabase/functions/create-event-checkout/index.ts",
  "supabase/functions/event-notifications/index.ts",
  "supabase/functions/event-reminders/index.ts",
  "supabase/functions/send-notification/index.ts",
  "supabase/functions/stripe-webhook/index.ts",
] as const;

const bannedPublicCopy: Array<{ label: string; pattern: RegExp }> = [
  { label: "door copy", pattern: /Show this at the door|door for check-in/i },
  { label: "entry copy", pattern: /\bat entry\b/i },
  { label: "in-person check-in", pattern: /in-person check-in/i },
  { label: "directions CTA", pattern: /\bGet Directions\b/i },
  { label: "secret physical location", pattern: /Secret Location|Address revealed/i },
  { label: "ticket header", pattern: /\bYour Ticket\b/i },
  { label: "ticket CTA", pattern: /\bView Ticket\b|\bGet Tickets\b|\bPurchase Ticket\b/i },
  { label: "ticket price label", pattern: /\bTicket price\b/i },
  { label: "checkout product ticket name", pattern: /\bVibely Event Ticket\b/i },
  { label: "legal/support ticket wording", pattern: /\bEvent tickets\b|\bEvents & tickets\b/i },
  { label: "venue section", pattern: /\bThe Venue\b/i },
  { label: "physical/venue email confirmation", pattern: /Check your email for confirmation/i },
  { label: "payment ticket reconciliation", pattern: /could not confirm this event ticket|reconcile the ticket/i },
  { label: "booking public copy", pattern: /\bManage Booking\b|\bBooking closed\b|\bBooking changes\b|\bbooking record\b|\bsync your booking\b/i },
  { label: "seat public copy", pattern: /offered your seat|confirmed seat|Your seat/i },
  { label: "seat in string literal", pattern: /["'`][^"'`]*\bseats?\b[^"'`]*["'`]/i },
  { label: "standalone ticket label", pattern: />\s*Ticket\s*</i },
];

function readProjectFile(relativePath: string): string {
  const absolutePath = join(root, relativePath);
  assert.equal(existsSync(absolutePath), true, `${relativePath} should exist`);
  return readFileSync(absolutePath, "utf8");
}

test("public event surfaces use online-only registration and lobby copy", () => {
  for (const file of publicEventSurfaceFiles) {
    const source = readProjectFile(file);

    for (const { label, pattern } of bannedPublicCopy) {
      assert.doesNotMatch(source, pattern, `${file} contains banned ${label}`);
    }
  }
});
