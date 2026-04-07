export function isWebShareAbortError(error: unknown): boolean {
  if (!error) return false;

  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError";
  }

  const name =
    typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
      ? error.name
      : "";
  const message =
    typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message
      : "";

  return name === "AbortError" || /aborted|cancelled|canceled/i.test(message);
}
