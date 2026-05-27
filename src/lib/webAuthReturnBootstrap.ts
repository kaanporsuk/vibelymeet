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

export function scrubCurrentAuthReturnUrl(authReturnUrl: string): void {
  if (typeof window === 'undefined') return;
  if (window.location.href !== authReturnUrl) return;

  try {
    window.history.replaceState(
      window.history.state,
      document.title,
      window.location.pathname,
    );
  } catch {
    // Leave navigation to the normal auth-return completion path.
  }
}
