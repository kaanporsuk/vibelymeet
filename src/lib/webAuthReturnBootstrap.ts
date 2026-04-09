let capturedInitialAuthReturnUrl =
  typeof window !== 'undefined' ? window.location.href : null;
let capturedInitialAuthReturnConsumed = false;

export function peekCapturedInitialAuthReturnUrl(): string | null {
  if (capturedInitialAuthReturnConsumed) return null;
  return capturedInitialAuthReturnUrl;
}

export function consumeCapturedInitialAuthReturnUrl(): string | null {
  if (capturedInitialAuthReturnConsumed) return null;
  capturedInitialAuthReturnConsumed = true;
  return capturedInitialAuthReturnUrl;
}

export function markCapturedInitialAuthReturnConsumed(url?: string | null): void {
  if (
    url
    && capturedInitialAuthReturnUrl
    && capturedInitialAuthReturnUrl !== url
  ) {
    return;
  }
  capturedInitialAuthReturnConsumed = true;
}

export function clearCapturedInitialAuthReturnUrl(): void {
  capturedInitialAuthReturnUrl = null;
  capturedInitialAuthReturnConsumed = true;
}
