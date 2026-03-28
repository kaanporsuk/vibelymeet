/**
 * Normalize connectivity-related failures so we never surface raw JS exception text in chat UI.
 */

export function isLikelyNetworkFailure(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('networkerror') ||
    msg.includes('internet connection appears to be offline') ||
    msg.includes('connection appears to be offline') ||
    msg.includes('the request timed out') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('err_network') ||
    msg.includes('not connected to the internet')
  );
}

export function chatOfflineWillSendCopy(isVibeClip: boolean): string {
  return isVibeClip
    ? "You're offline — your Vibe Clip will send when you reconnect."
    : "You're offline — this will send when you reconnect.";
}

export function chatMediaActionFailureCopy(): string {
  return "Couldn't complete that. Check your connection and try again.";
}

/** User-facing copy for Alerts and inline errors (not the outbox row). */
export function chatFriendlyErrorFromUnknown(err: unknown, opts?: { isVibeClip?: boolean }): string {
  if (isLikelyNetworkFailure(err)) {
    return opts?.isVibeClip ? chatOfflineWillSendCopy(true) : chatMediaActionFailureCopy();
  }
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (/typeerror|referenceerror|syntaxerror/i.test(raw)) {
    return chatMediaActionFailureCopy();
  }
  if (raw.length > 160) {
    return chatMediaActionFailureCopy();
  }
  return raw || chatMediaActionFailureCopy();
}

/** Stored on outbox rows when send fails for non-network reasons; never raw TypeError text. */
export function outboxFailureUserMessage(raw: string, isVibeClip: boolean): string {
  if (isLikelyNetworkFailure({ message: raw })) return chatMediaActionFailureCopy();
  if (/typeerror|referenceerror|syntaxerror/i.test(raw)) return chatMediaActionFailureCopy();
  if (raw.length > 160) return chatMediaActionFailureCopy();
  return raw || chatMediaActionFailureCopy();
}
