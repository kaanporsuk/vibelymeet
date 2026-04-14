export function isLikelyNetworkFailure(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return (
    msg.includes("network request failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed") ||
    msg.includes("networkerror") ||
    msg.includes("the request timed out") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("err_network") ||
    msg.includes("not connected to the internet")
  );
}

export function outboxFailureUserMessage(raw: string, isVibeClip: boolean): string {
  if (isLikelyNetworkFailure({ message: raw })) {
    return "Couldn't send — check your connection and try again.";
  }
  if (/typeerror|referenceerror|syntaxerror/i.test(raw)) {
    return "Couldn't send — try again.";
  }
  if (raw.length > 160) return "Couldn't send — try again.";
  return raw || "Couldn't send — try again.";
}
