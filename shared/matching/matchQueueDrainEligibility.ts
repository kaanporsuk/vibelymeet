/**
 * When the web client may call `drain_match_queue` opportunistically.
 *
 * Server RPCs still enforce presence, admission, and conflicts; this only gates the client poll.
 * Post-date survey opts in via `enableSurveyPhaseDrain` so arbitrary `in_survey` callers do not drain by default.
 */
export function isMatchQueueDrainEligible(
  currentStatus: string,
  options?: { enableSurveyPhaseDrain?: boolean },
): boolean {
  if (currentStatus === "browsing" || currentStatus === "idle") return true;
  return options?.enableSurveyPhaseDrain === true && currentStatus === "in_survey";
}
