export type ReportReasonId =
  | "harassment"
  | "fake"
  | "inappropriate"
  | "spam"
  | "safety"
  | "underage"
  | "other";

export type ReportReason = {
  id: ReportReasonId;
  label: string;
};

export const REPORT_REASONS: readonly ReportReason[] = [
  { id: "harassment", label: "Harassment or bullying" },
  { id: "fake", label: "Fake profile / catfish" },
  { id: "inappropriate", label: "Inappropriate sexual content" },
  { id: "spam", label: "Spam or scam" },
  { id: "safety", label: "Safety concern" },
  { id: "underage", label: "Underage user" },
  { id: "other", label: "Other" },
] as const;

