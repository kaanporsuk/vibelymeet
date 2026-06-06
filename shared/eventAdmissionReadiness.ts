export type EventAdmissionReadinessReason =
  | "confirmed"
  | "waitlisted"
  | "not_registered"
  | "paid_not_confirmed";

export type EventAdmissionReadinessInput = {
  admissionStatus?: string | null;
  admission_status?: string | null;
  paymentStatus?: string | null;
  payment_status?: string | null;
};

export type EventAdmissionReadinessSnapshot = {
  admissionStatus: string | null;
  paymentStatus: string | null;
  isConfirmed: boolean;
  isWaitlisted: boolean;
  canEnterLobby: boolean;
  paidLikeButNotConfirmed: boolean;
  admissionReadinessReason: EventAdmissionReadinessReason;
};

const PAID_LIKE_PAYMENT_STATUSES = new Set(["paid", "settled", "verified"]);

function normalizeStatus(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function isConfirmedAdmission(admissionStatus: string | null | undefined): boolean {
  return normalizeStatus(admissionStatus) === "confirmed";
}

export function isWaitlistedAdmission(admissionStatus: string | null | undefined): boolean {
  return normalizeStatus(admissionStatus) === "waitlisted";
}

export function isPaidLikePaymentStatus(paymentStatus: string | null | undefined): boolean {
  const normalized = normalizeStatus(paymentStatus);
  return normalized != null && PAID_LIKE_PAYMENT_STATUSES.has(normalized);
}

export function resolveEventAdmissionReadiness(
  input: EventAdmissionReadinessInput = {},
): EventAdmissionReadinessSnapshot {
  const admissionStatus = normalizeStatus(input.admissionStatus ?? input.admission_status);
  const paymentStatus = normalizeStatus(input.paymentStatus ?? input.payment_status);
  const isConfirmed = isConfirmedAdmission(admissionStatus);
  const isWaitlisted = isWaitlistedAdmission(admissionStatus);
  const paidLikeButNotConfirmed = isPaidLikePaymentStatus(paymentStatus) && !isConfirmed;

  return {
    admissionStatus,
    paymentStatus,
    isConfirmed,
    isWaitlisted,
    canEnterLobby: isConfirmed,
    paidLikeButNotConfirmed,
    admissionReadinessReason: isConfirmed
      ? "confirmed"
      : paidLikeButNotConfirmed
        ? "paid_not_confirmed"
        : isWaitlisted
          ? "waitlisted"
          : "not_registered",
  };
}
