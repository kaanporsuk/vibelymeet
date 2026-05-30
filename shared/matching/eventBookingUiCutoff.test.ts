import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("web event details gates registration-management entry points behind self-cancel editability", () => {
  const eventDetails = readProjectFile("src/pages/EventDetails.tsx");
  const manageRegistrationModal = readProjectFile("src/components/events/ManageRegistrationModal.tsx");

  assert.match(eventDetails, /const canSelfCancelRegistration = bookingEditability\.canSelfCancel/);
  assert.match(eventDetails, /const \[eventClockMs, setEventClockMs\] = useState\(\(\) => Date\.now\(\)\)/);
  assert.match(eventDetails, /window\.setTimeout\(refreshClock, delayMs \+ EVENT_DETAILS_CUTOFF_TICK_GRACE_MS\)/);
  assert.match(eventDetails, /window\.setInterval\(refreshClock, EVENT_DETAILS_CLOCK_REFRESH_MS\)/);
  assert.match(eventDetails, /resolveEventLifecycle\(\{[\s\S]*nowMs: eventClockMs/);
  assert.match(eventDetails, /resolveEventBookingEditability\(\{[\s\S]*nowMs: eventClockMs/);
  assert.match(
    eventDetails,
    /const canViewRegistration =[\s\S]*hasEventAdmission &&[\s\S]*canSelfCancelRegistration \|\| \(isConfirmed && eventLifecycle\.isLive && !eventClosedForBookingCopy\)/,
  );
  assert.match(eventDetails, /canViewRegistration[\s\S]*\? \(\) => setShowRegistrationStub\(true\)/);
  assert.match(eventDetails, /isOpen=\{showManageRegistration && canSelfCancelRegistration\}/);
  assert.match(eventDetails, /isOpen=\{showCancelRegistrationModal && canSelfCancelRegistration\}/);
  assert.match(eventDetails, /showRegistrationStub && canViewRegistration/);
  assert.match(eventDetails, /canCancel=\{canSelfCancelRegistration\}/);
  assert.match(eventDetails, /Registration changes are closed for this event/);

  assert.match(manageRegistrationModal, /canCancel\?: boolean/);
  assert.match(manageRegistrationModal, /canCancel = true/);
  assert.match(manageRegistrationModal, /\{canCancel \? \([\s\S]*\{releaseCta\}[\s\S]*\) : null\}/);
});

test("mobile event details gates registration-management and registration-stub entry points behind self-cancel editability", () => {
  const eventDetails = readProjectFile("apps/mobile/app/(tabs)/events/[id].tsx");
  const manageRegistrationModal = readProjectFile("apps/mobile/components/events/ManageRegistrationModal.tsx");

  assert.match(eventDetails, /const canSelfCancelRegistration = bookingEditability\?\.canSelfCancel \?\? false/);
  assert.match(eventDetails, /visible=\{showManageRegistration && canSelfCancelRegistration\}/);
  assert.match(
    eventDetails,
    /const canViewRegistration =[\s\S]*hasAdmission && \(canSelfCancelRegistration \|\| \(isConfirmed && eventLive && !eventClosedForBookingCopy\)\)/,
  );
  assert.match(eventDetails, /visible=\{showRegistrationStub && canViewRegistration\}/);
  assert.match(eventDetails, /canCancel=\{canSelfCancelRegistration\}/);
  assert.match(eventDetails, /Registration changes are closed for this event/);
  assert.match(eventDetails, /label="Registration Closed"/);

  assert.match(manageRegistrationModal, /canCancel\?: boolean/);
  assert.match(manageRegistrationModal, /canCancel = true/);
  assert.match(manageRegistrationModal, /\{canCancel \? \([\s\S]*\{releaseCta\}[\s\S]*\) : null\}/);
});
