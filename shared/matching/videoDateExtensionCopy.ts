export type VideoDateExtensionCreditType = "extra_time" | "extended_vibe";
export type VideoDateExtensionState =
  | "available"
  | "local_pending"
  | "partner_pending"
  | "applied"
  | "insufficient_credits"
  | "failed";

export type VideoDateExtensionCopy = {
  label: string;
  actionVerb: string;
  accessibilityVerb: string;
  title: string;
  message: string;
  toastMessage: string | null;
};

function minutesForType(type: VideoDateExtensionCreditType): number {
  return type === "extra_time" ? 2 : 5;
}

function creditName(type: VideoDateExtensionCreditType): string {
  return type === "extra_time" ? "Extra Time" : "Extended Vibe";
}

function formatMinutes(minutes: number): string {
  const label = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  return `${label} extra ${minutes === 1 ? "minute" : "minutes"}`;
}

function normalizeMinutes(minutes: number | null | undefined, type: VideoDateExtensionCreditType): number {
  if (typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0) {
    return minutes;
  }
  return minutesForType(type);
}

export function resolveVideoDateExtensionCopy(input: {
  type?: VideoDateExtensionCreditType;
  state: VideoDateExtensionState;
  mutualMode?: boolean | null;
  minutes?: number | null;
  userMessage?: string | null;
}): VideoDateExtensionCopy {
  const type = input.type ?? "extra_time";
  const minutes = normalizeMinutes(input.minutes, type);
  const credit = creditName(type);

  switch (input.state) {
    case "partner_pending":
      return {
        label: `Accept +${minutes}`,
        actionVerb: "Accept adding",
        accessibilityVerb: "Accept adding",
        title: "Accept more time",
        message: `Accept ${credit} to add ${minutes} minutes to this date.`,
        toastMessage: null,
      };
    case "local_pending":
      return {
        label: `Ask +${minutes}`,
        actionVerb: "Ask to add",
        accessibilityVerb: "Ask to add",
        title: "Request sent",
        message: "The date extends if your match accepts.",
        toastMessage: "Request sent. The date extends if your match accepts.",
      };
    case "applied":
      return {
        label: `+${minutes} min`,
        actionVerb: "Add",
        accessibilityVerb: "Add",
        title: "Extra time added",
        message: `${formatMinutes(minutes)} added.`,
        toastMessage: `${formatMinutes(minutes)} added!`,
      };
    case "insufficient_credits":
      return {
        label: "Get Credits",
        actionVerb: "Get",
        accessibilityVerb: "Get",
        title: "Get credits",
        message: "Extra Time adds +2 min. Extended Vibe adds +5 min.",
        toastMessage: null,
      };
    case "failed":
      return {
        label: input.mutualMode ? `Ask +${minutes}` : `+${minutes} min`,
        actionVerb: input.mutualMode ? "Ask to add" : "Add",
        accessibilityVerb: input.mutualMode ? "Ask to add" : "Add",
        title: "Could not add time",
        message: input.userMessage || "Could not add time. Try again.",
        toastMessage: input.userMessage || "Could not add time. Try again.",
      };
    case "available":
      return {
        label: input.mutualMode ? `Ask +${minutes}` : `+${minutes} min`,
        actionVerb: input.mutualMode ? "Ask to add" : "Add",
        accessibilityVerb: input.mutualMode ? "Ask to add" : "Add",
        title: `${credit} available`,
        message: input.mutualMode
          ? `Ask your match to add ${minutes} minutes.`
          : `Add ${minutes} minutes with ${credit}.`,
        toastMessage: null,
      };
  }
}
