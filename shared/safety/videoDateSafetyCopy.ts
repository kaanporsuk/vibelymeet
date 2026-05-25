export type VideoDateSafetySubmitMode = "report" | "end";
export type VideoDateSafetyNextDestination = "stay" | "survey" | "lobby" | "home";
export type VideoDateSafetyTone = "success" | "warning" | "error";

export type VideoDateSafetySubmitCopy = {
  title: string;
  message: string;
  primaryActionLabel: string;
  secondaryActionLabel: string | null;
  tone: VideoDateSafetyTone;
  nextDestination: VideoDateSafetyNextDestination;
};

function cleanError(error: string | null | undefined): string | null {
  if (typeof error !== "string") return null;
  const trimmed = error.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function messageForSafetyError(error: string | null, mode: VideoDateSafetySubmitMode): string {
  switch (error) {
    case "not_authenticated":
    case "unauthorized":
      return "Please sign in again, then try once more.";
    case "invalid_reason":
      return "Choose a report reason and try again.";
    case "invalid_idempotency_key":
    case "idempotency_conflict":
      return "This safety action could not be verified. Try again.";
    case "command_in_progress":
      return "A safety action is already in progress. Wait a moment and try again.";
    case "rate_limited":
      return "You have sent several reports recently. Please try again later.";
    case "session_not_found":
    case "not_participant":
    case "session_ended":
      return "This date is no longer available from here.";
    case "safety_end_transition_rejected":
      return mode === "end"
        ? "We could not end the date from here. Leave the call if you need to step away."
        : "We could not finish this safety action. Try again in a moment.";
    default:
      return "We could not send the report. Try again in a moment.";
  }
}

export function resolveVideoDateSafetySubmitCopy(input: {
  ok: boolean;
  mode: VideoDateSafetySubmitMode;
  alsoBlock?: boolean | null;
  ended?: boolean | null;
  surveyRequired?: boolean | null;
  idempotent?: boolean | null;
  error?: string | null;
  reportRecorded?: boolean | null;
  retryable?: boolean | null;
}): VideoDateSafetySubmitCopy {
  if (!input.ok) {
    const error = cleanError(input.error);
    if (input.reportRecorded) {
      return {
        title: "Report received",
        message:
          input.mode === "end"
            ? "We received your report, but could not end the date from here. Leave the call if you need to step away."
            : "We received your report, but could not finish the follow-up action. Try again if you need to block or end the date.",
        primaryActionLabel: "Continue",
        secondaryActionLabel: null,
        tone: "warning",
        nextDestination: "stay",
      };
    }
    return {
      title: "Could not send report",
      message: messageForSafetyError(error, input.mode),
      primaryActionLabel: input.retryable === false ? "Close" : "Try again",
      secondaryActionLabel: "Cancel",
      tone: "error",
      nextDestination: "stay",
    };
  }

  const blockSentence = input.alsoBlock ? " This person is blocked." : "";
  const duplicateSentence = input.idempotent ? " We already had this report, so nothing was duplicated." : "";

  if (input.ended || input.mode === "end") {
    return {
      title: "Report sent",
      message: input.surveyRequired
        ? `We received your report and are ending the date.${blockSentence} Next, we will take you to feedback.${duplicateSentence}`
        : `We received your report and are ending the date.${blockSentence}${duplicateSentence}`,
      primaryActionLabel: input.surveyRequired ? "Continue to feedback" : "Continue",
      secondaryActionLabel: null,
      tone: "success",
      nextDestination: input.surveyRequired ? "survey" : "lobby",
    };
  }

  return {
    title: "Report received",
    message: `Thanks. We received your report and our team will review it.${blockSentence}${duplicateSentence}`,
    primaryActionLabel: "Continue call",
    secondaryActionLabel: null,
    tone: "success",
    nextDestination: "stay",
  };
}
