import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("web event details gates booking-management entry points behind self-cancel editability", () => {
  const eventDetails = readProjectFile("src/pages/EventDetails.tsx");
  const manageBookingModal = readProjectFile("src/components/events/ManageBookingModal.tsx");

  assert.match(eventDetails, /const canSelfCancelRegistration = bookingEditability\.canSelfCancel/);
  assert.match(
    eventDetails,
    /const canViewTicket =[\s\S]*hasEventAdmission &&[\s\S]*canSelfCancelRegistration \|\| \(isConfirmed && eventLifecycle\.isLive && !eventClosedForBookingCopy\)/,
  );
  assert.match(eventDetails, /canViewTicket[\s\S]*\? \(\) => setShowTicket\(true\)/);
  assert.match(eventDetails, /isOpen=\{showManageBooking && canSelfCancelRegistration\}/);
  assert.match(eventDetails, /isOpen=\{showCancelModal && canSelfCancelRegistration\}/);
  assert.match(eventDetails, /showTicket && canViewTicket/);
  assert.match(eventDetails, /canCancel=\{canSelfCancelRegistration\}/);
  assert.match(eventDetails, /Booking changes are closed for this event/);

  assert.match(manageBookingModal, /canCancel\?: boolean/);
  assert.match(manageBookingModal, /canCancel = true/);
  assert.match(manageBookingModal, /\{canCancel \? \([\s\S]*\{releaseCta\}[\s\S]*\) : null\}/);
});

test("mobile event details gates booking-management and stale ticket entry points behind self-cancel editability", () => {
  const eventDetails = readProjectFile("apps/mobile/app/(tabs)/events/[id].tsx");
  const manageBookingModal = readProjectFile("apps/mobile/components/events/ManageBookingModal.tsx");

  assert.match(eventDetails, /const canSelfCancelRegistration = bookingEditability\?\.canSelfCancel \?\? false/);
  assert.match(eventDetails, /visible=\{showManageBooking && canSelfCancelRegistration\}/);
  assert.match(
    eventDetails,
    /const canViewTicket =[\s\S]*hasAdmission && \(canSelfCancelRegistration \|\| \(isConfirmed && eventLive && !eventClosedForBookingCopy\)\)/,
  );
  assert.match(eventDetails, /visible=\{showTicket && canViewTicket\}/);
  assert.match(eventDetails, /canCancel=\{canSelfCancelRegistration\}/);
  assert.match(eventDetails, /Booking changes are closed for this event/);
  assert.match(eventDetails, /label="Booking Closed"/);

  assert.match(manageBookingModal, /canCancel\?: boolean/);
  assert.match(manageBookingModal, /canCancel = true/);
  assert.match(manageBookingModal, /\{canCancel \? \([\s\S]*\{releaseCta\}[\s\S]*\) : null\}/);
});
