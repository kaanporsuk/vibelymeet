import test from "node:test";
import assert from "node:assert/strict";
import {
  isConfirmedAdmission,
  isPaidLikePaymentStatus,
  isWaitlistedAdmission,
  resolveEventAdmissionReadiness,
} from "./eventAdmissionReadiness";

test("confirmed admission is the only lobby-ready admission state", () => {
  const confirmed = resolveEventAdmissionReadiness({
    admissionStatus: "confirmed",
    paymentStatus: "paid",
  });

  assert.equal(isConfirmedAdmission(" confirmed "), true);
  assert.equal(confirmed.isConfirmed, true);
  assert.equal(confirmed.isWaitlisted, false);
  assert.equal(confirmed.canEnterLobby, true);
  assert.equal(confirmed.paidLikeButNotConfirmed, false);
  assert.equal(confirmed.admissionReadinessReason, "confirmed");
});

test("waitlisted, missing, and unknown admission do not allow lobby readiness", () => {
  const waitlisted = resolveEventAdmissionReadiness({
    admission_status: "waitlisted",
    payment_status: "paid",
  });
  const missing = resolveEventAdmissionReadiness();
  const unknown = resolveEventAdmissionReadiness({
    admissionStatus: "pending_review",
    paymentStatus: "free",
  });

  assert.equal(isWaitlistedAdmission("WAITLISTED"), true);
  assert.equal(waitlisted.isWaitlisted, true);
  assert.equal(waitlisted.canEnterLobby, false);
  assert.equal(waitlisted.admissionReadinessReason, "paid_not_confirmed");
  assert.equal(missing.canEnterLobby, false);
  assert.equal(missing.admissionReadinessReason, "not_registered");
  assert.equal(unknown.canEnterLobby, false);
  assert.equal(unknown.admissionReadinessReason, "not_registered");

  const waitlistedWithoutPaidPayment = resolveEventAdmissionReadiness({
    admissionStatus: "waitlisted",
    paymentStatus: "free",
  });

  assert.equal(waitlistedWithoutPaidPayment.canEnterLobby, false);
  assert.equal(waitlistedWithoutPaidPayment.admissionReadinessReason, "waitlisted");
});

test("paid-like payment without confirmed admission is a setup diagnostic, not access", () => {
  for (const paymentStatus of ["paid", "settled", "verified"]) {
    const snapshot = resolveEventAdmissionReadiness({
      admissionStatus: "waitlisted",
      paymentStatus,
    });

    assert.equal(isPaidLikePaymentStatus(paymentStatus), true, paymentStatus);
    assert.equal(snapshot.canEnterLobby, false, paymentStatus);
    assert.equal(snapshot.paidLikeButNotConfirmed, true, paymentStatus);
    assert.equal(snapshot.admissionReadinessReason, "paid_not_confirmed", paymentStatus);
  }

  const paymentOnly = resolveEventAdmissionReadiness({
    admissionStatus: null,
    paymentStatus: "paid",
  });

  assert.equal(paymentOnly.canEnterLobby, false);
  assert.equal(paymentOnly.paidLikeButNotConfirmed, true);
  assert.equal(paymentOnly.admissionReadinessReason, "paid_not_confirmed");
});

test("payment status never overrides non-confirmed admission", () => {
  const paidPending = resolveEventAdmissionReadiness({
    admissionStatus: "pending",
    paymentStatus: "paid",
  });

  assert.equal(paidPending.isConfirmed, false);
  assert.equal(paidPending.canEnterLobby, false);
  assert.equal(paidPending.paidLikeButNotConfirmed, true);
  assert.equal(paidPending.admissionReadinessReason, "paid_not_confirmed");
});
