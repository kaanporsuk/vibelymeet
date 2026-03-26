type RefDedupeOptions<T> = {
  isDedupeCandidate: (message: T) => boolean;
  getRefId: (message: T) => string | null | undefined;
  getId: (message: T) => string;
};

/**
 * Keep only the latest message per `refId` among candidate rows.
 * Non-candidate rows always pass through unchanged.
 */
export function dedupeLatestByRefId<T>(messages: T[], options: RefDedupeOptions<T>): T[] {
  const lastByRef = new Map<string, string>();

  for (const message of messages) {
    if (!options.isDedupeCandidate(message)) continue;
    const refId = options.getRefId(message);
    if (!refId) continue;
    lastByRef.set(refId, options.getId(message));
  }

  return messages.filter((message) => {
    const refId = options.getRefId(message);
    if (!refId) return true;
    if (!options.isDedupeCandidate(message)) return true;
    return lastByRef.get(refId) === options.getId(message);
  });
}
