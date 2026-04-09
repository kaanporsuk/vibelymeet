import { supabase } from "@/integrations/supabase/client";
import {
  consumeCapturedInitialAuthReturnUrl,
  markCapturedInitialAuthReturnConsumed,
  peekCapturedInitialAuthReturnUrl,
} from "@/lib/webAuthReturnBootstrap";
import {
  hasPasswordRecoveryIntent,
  parseSupabaseAuthReturnUrl,
  type PasswordRecoveryStatus,
} from "@shared/authRedirect";

export type WebPasswordRecoveryState = {
  status: PasswordRecoveryStatus;
  error: string | null;
  userId: string | null;
  updatedAt: number;
};

export type WebPasswordRecoveryResult = {
  handled: boolean;
  recovery: boolean;
  error: Error | null;
  sessionUserId: string | null;
};

const STORAGE_KEY = "vibely_password_recovery";
const STORAGE_EVENT = "vibely:password-recovery";
const MAX_STATE_AGE_MS = 30 * 60 * 1000;

const EMPTY_RECOVERY_STATE: WebPasswordRecoveryState = {
  status: "none",
  error: null,
  userId: null,
  updatedAt: 0,
};

function getRecoveryStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function emitRecoveryStateChange(nextState: WebPasswordRecoveryState): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<WebPasswordRecoveryState>(STORAGE_EVENT, {
      detail: nextState,
    }),
  );
}

function writeWebPasswordRecoveryState(nextState: WebPasswordRecoveryState): void {
  const storage = getRecoveryStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    } catch {
      // Ignore storage failures; the in-memory navigation still proceeds.
    }
  }
  emitRecoveryStateChange(nextState);
}

function sessionChanged(
  currentSession: {
    userId: string | null;
    accessToken: string | null;
  },
  baselineSession: {
    userId: string | null;
    accessToken: string | null;
  },
): boolean {
  return (
    currentSession.userId !== baselineSession.userId
    || currentSession.accessToken !== baselineSession.accessToken
  );
}

async function readCurrentSessionSnapshot() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    session,
    snapshot: {
      userId: session?.user?.id ?? null,
      accessToken: session?.access_token ?? null,
    },
  };
}

export function readWebPasswordRecoveryState(): WebPasswordRecoveryState {
  const storage = getRecoveryStorage();
  if (!storage) return EMPTY_RECOVERY_STATE;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_RECOVERY_STATE;

    const parsed = JSON.parse(raw) as Partial<WebPasswordRecoveryState>;
    const status = parsed.status;
    if (
      status !== "ready"
      && status !== "invalid"
      && status !== "none"
      && status !== "success"
    ) {
      storage.removeItem(STORAGE_KEY);
      return EMPTY_RECOVERY_STATE;
    }

    const nextState: WebPasswordRecoveryState = {
      status,
      error: typeof parsed.error === "string" ? parsed.error : null,
      userId: typeof parsed.userId === "string" ? parsed.userId : null,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };

    if (
      nextState.status !== "none"
      && Date.now() - nextState.updatedAt > MAX_STATE_AGE_MS
    ) {
      storage.removeItem(STORAGE_KEY);
      return EMPTY_RECOVERY_STATE;
    }

    return nextState;
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore malformed storage cleanup failures.
    }
    return EMPTY_RECOVERY_STATE;
  }
}

export function markWebPasswordRecoveryReady(userId: string | null): void {
  writeWebPasswordRecoveryState({
    status: "ready",
    error: null,
    userId,
    updatedAt: Date.now(),
  });
}

export function markWebPasswordRecoveryInvalid(error: string): void {
  writeWebPasswordRecoveryState({
    status: "invalid",
    error,
    userId: null,
    updatedAt: Date.now(),
  });
}

export function markWebPasswordRecoverySuccess(userId: string | null): void {
  writeWebPasswordRecoveryState({
    status: "success",
    error: null,
    userId,
    updatedAt: Date.now(),
  });
}

export function clearWebPasswordRecoveryState(): void {
  const storage = getRecoveryStorage();
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore cleanup failures.
    }
  }
  emitRecoveryStateChange(EMPTY_RECOVERY_STATE);
}

export function subscribeWebPasswordRecoveryState(
  listener: (nextState: WebPasswordRecoveryState) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<WebPasswordRecoveryState>;
    listener(customEvent.detail ?? readWebPasswordRecoveryState());
  };

  window.addEventListener(STORAGE_EVENT, handleEvent as EventListener);
  return () => {
    window.removeEventListener(STORAGE_EVENT, handleEvent as EventListener);
  };
}

export function isBrowserRecoveryReturnUrl(url: string): boolean {
  const parsed = parseSupabaseAuthReturnUrl(url);
  if (!parsed.isValidUrl || !parsed.hasAuthPayload) return false;
  return hasPasswordRecoveryIntent(parsed.type, [parsed.pathname]);
}

export function getPendingBrowserRecoveryUrl(currentUrl: string): string | null {
  const bootUrl = peekCapturedInitialAuthReturnUrl();
  const currentIsRecoveryReturn = isBrowserRecoveryReturnUrl(currentUrl);

  if (currentIsRecoveryReturn) {
    if (bootUrl === currentUrl) {
      markCapturedInitialAuthReturnConsumed(currentUrl);
    }
    return currentUrl;
  }

  if (bootUrl && isBrowserRecoveryReturnUrl(bootUrl)) {
    return consumeCapturedInitialAuthReturnUrl();
  }

  return null;
}

function passwordRecoveryFallbackError(): Error {
  return new Error(
    "We couldn't confirm that reset link. Request a fresh password reset email and try again.",
  );
}

export async function completeWebPasswordRecoveryFromUrl(
  url: string,
): Promise<WebPasswordRecoveryResult> {
  const parsed = parseSupabaseAuthReturnUrl(url);
  const recovery = parsed.isValidUrl
    && parsed.hasAuthPayload
    && hasPasswordRecoveryIntent(parsed.type, [parsed.pathname]);

  if (!recovery) {
    return {
      handled: false,
      recovery: false,
      error: null,
      sessionUserId: null,
    };
  }

  if (parsed.authError) {
    return {
      handled: true,
      recovery: true,
      error: new Error(parsed.authError),
      sessionUserId: null,
    };
  }

  const initialSession = await readCurrentSessionSnapshot();

  if (parsed.accessToken && parsed.refreshToken) {
    const alreadyApplied = initialSession.snapshot.accessToken === parsed.accessToken;
    if (!alreadyApplied) {
      const { error } = await supabase.auth.setSession({
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken,
      });
      if (error) {
        return {
          handled: true,
          recovery: true,
          error: new Error(error.message),
          sessionUserId: null,
        };
      }
    }

    const nextSession = await readCurrentSessionSnapshot();
    if (nextSession.snapshot.userId) {
      return {
        handled: true,
        recovery: true,
        error: null,
        sessionUserId: nextSession.snapshot.userId,
      };
    }

    return {
      handled: true,
      recovery: true,
      error: passwordRecoveryFallbackError(),
      sessionUserId: null,
    };
  }

  if (parsed.code || parsed.tokenHash) {
    await new Promise((resolve) => setTimeout(resolve, 150));

    const currentSession = await readCurrentSessionSnapshot();
    if (
      currentSession.snapshot.userId
      && sessionChanged(currentSession.snapshot, initialSession.snapshot)
    ) {
      return {
        handled: true,
        recovery: true,
        error: null,
        sessionUserId: currentSession.snapshot.userId,
      };
    }

    if (parsed.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
      const nextSession = await readCurrentSessionSnapshot();
      if (!error && nextSession.snapshot.userId) {
        return {
          handled: true,
          recovery: true,
          error: null,
          sessionUserId: nextSession.snapshot.userId,
        };
      }

      if (
        error
        && nextSession.snapshot.userId
        && sessionChanged(nextSession.snapshot, initialSession.snapshot)
      ) {
        return {
          handled: true,
          recovery: true,
          error: null,
          sessionUserId: nextSession.snapshot.userId,
        };
      }

      return {
        handled: true,
        recovery: true,
        error: error ? new Error(error.message) : passwordRecoveryFallbackError(),
        sessionUserId: null,
      };
    }

    if (parsed.tokenHash) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: parsed.tokenHash,
        type: "recovery",
      });
      const nextSession = await readCurrentSessionSnapshot();
      if (!error && nextSession.snapshot.userId) {
        return {
          handled: true,
          recovery: true,
          error: null,
          sessionUserId: nextSession.snapshot.userId,
        };
      }

      return {
        handled: true,
        recovery: true,
        error: error ? new Error(error.message) : passwordRecoveryFallbackError(),
        sessionUserId: null,
      };
    }
  }

  return {
    handled: true,
    recovery: true,
    error: passwordRecoveryFallbackError(),
    sessionUserId: null,
  };
}
