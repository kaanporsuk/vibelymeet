import { supabase } from "@/integrations/supabase/client";
import {
  consumeCapturedInitialAuthReturnUrl,
  markCapturedInitialAuthReturnConsumed,
  peekCapturedInitialAuthReturnUrl,
} from "@/lib/webAuthReturnBootstrap";
import {
  hasPasswordRecoveryIntent,
  normalizeAuthReturnTokenHashOtpType,
  parseSupabaseAuthReturnUrl,
} from "@shared/authRedirect";
import { safeAuthErrorMessage } from "@clientShared/authErrorCopy";

export type WebAuthReturnResult = {
  handled: boolean;
  error: Error | null;
  sessionUserId: string | null;
};

function authReturnError(error: unknown, fallback: string): Error {
  return new Error(safeAuthErrorMessage(error, fallback));
}

function authReturnFallbackError(): Error {
  return new Error("We couldn't confirm that sign-in link. Request a fresh link and try again.");
}

function isGenericBrowserAuthReturnUrl(url: string): boolean {
  const parsed = parseSupabaseAuthReturnUrl(url);
  if (!parsed.isValidUrl || !parsed.hasAuthPayload) return false;
  if (hasPasswordRecoveryIntent(parsed.type, [parsed.pathname])) return false;

  try {
    const currentUrl = new URL(url);
    if (currentUrl.searchParams.get("provider_callback") === "true") return false;
    if (currentUrl.searchParams.get("linking") === "true") return false;
  } catch {
    return false;
  }

  return true;
}

export function getPendingBrowserAuthReturnUrl(currentUrl: string): string | null {
  const bootUrl = peekCapturedInitialAuthReturnUrl();
  const currentIsAuthReturn = isGenericBrowserAuthReturnUrl(currentUrl);

  if (currentIsAuthReturn) {
    if (bootUrl === currentUrl) {
      markCapturedInitialAuthReturnConsumed(currentUrl);
    }
    return currentUrl;
  }

  if (bootUrl && isGenericBrowserAuthReturnUrl(bootUrl)) {
    return consumeCapturedInitialAuthReturnUrl();
  }

  return null;
}

async function readSessionUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export async function completeWebAuthReturnFromUrl(url: string): Promise<WebAuthReturnResult> {
  if (!isGenericBrowserAuthReturnUrl(url)) {
    return {
      handled: false,
      error: null,
      sessionUserId: null,
    };
  }

  const parsed = parseSupabaseAuthReturnUrl(url);
  if (parsed.authError) {
    return {
      handled: true,
      error: authReturnError({ message: parsed.authError }, "Could not complete sign-in. Try again."),
      sessionUserId: null,
    };
  }

  if (parsed.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
    const sessionUserId = await readSessionUserId();
    return {
      handled: true,
      error: error || !sessionUserId
        ? authReturnError(error ?? authReturnFallbackError(), "Could not complete sign-in. Try again.")
        : null,
      sessionUserId,
    };
  }

  if (parsed.tokenHash) {
    const otpType = normalizeAuthReturnTokenHashOtpType(parsed.type, false);
    if (!otpType) {
      return {
        handled: true,
        error: authReturnFallbackError(),
        sessionUserId: null,
      };
    }

    const { error } = await supabase.auth.verifyOtp({
      token_hash: parsed.tokenHash,
      type: otpType,
    });
    const sessionUserId = await readSessionUserId();
    return {
      handled: true,
      error: error || !sessionUserId
        ? authReturnError(error ?? authReturnFallbackError(), "Could not complete sign-in. Try again.")
        : null,
      sessionUserId,
    };
  }

  if (parsed.accessToken && parsed.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    });
    const sessionUserId = await readSessionUserId();
    return {
      handled: true,
      error: error || !sessionUserId
        ? authReturnError(error ?? authReturnFallbackError(), "Could not complete sign-in. Try again.")
        : null,
      sessionUserId,
    };
  }

  return {
    handled: true,
    error: authReturnFallbackError(),
    sessionUserId: null,
  };
}
