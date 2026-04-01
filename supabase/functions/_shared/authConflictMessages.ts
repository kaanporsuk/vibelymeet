/**
 * Shared auth conflict copy + detection for web and native (Supabase Auth / OAuth errors).
 * No runtime dependency on Deno/Edge — safe to import from Vite and Expo.
 */

export const AUTH_COPY = {
  phoneSignInWithCode: 'This phone number is already registered. Sign in with your code.',
  emailSignInInstead: 'This email is already registered. Sign in instead.',
  googleSignInWithGoogle: 'This Google account is already registered. Sign in with Google.',
  appleSignInWithApple: 'This Apple account is already registered. Sign in with Apple.',
  crossProvider:
    'This account is already registered with another sign-in method. Use the method you used before.',
} as const;

export type AuthConflictContext =
  | 'phone_otp_send'
  | 'phone_otp_resend'
  | 'email_sign_in'
  | 'email_sign_up'
  | 'google'
  | 'apple';

export type AuthConflictResult = {
  /** User-facing conflict message, or null to fall back to generic handler */
  message: string | null;
  /** When true, switch UI to email sign-in and keep email field */
  suggestEmailSignIn: boolean;
};

function normalize(err: unknown): { msg: string; code: string } {
  if (err == null) return { msg: '', code: '' };
  if (typeof err === 'string') return { msg: err, code: '' };
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const msg = String(o.message ?? o.error_description ?? o.msg ?? '');
    const code = String(o.code ?? o.error ?? '');
    return { msg, code };
  }
  return { msg: String(err), code: '' };
}

function isUserAlreadyExists(msg: string, code: string): boolean {
  const m = msg.toLowerCase();
  const c = code.toLowerCase();
  if (c.includes('user_already') || c.includes('already_exists')) return true;
  if (
    /user already exists|already registered|already been registered|email (address )?is already|email.*already.*(exist|registered|taken)|duplicate user|account.*already exist|signups not allowed for this user/i.test(
      m
    )
  ) {
    return true;
  }
  return false;
}

function isCrossProviderOrIdentityConflict(msg: string, code: string): boolean {
  const m = msg.toLowerCase();
  const c = code.toLowerCase();
  if (
    /identity|identities|linked to a different|different provider|another sign|method you used|cannot link|already linked|associated with another user|provider.*already|use .* to sign in/i.test(
      m
    )
  ) {
    return true;
  }
  if (c.includes('identity')) return true;
  return false;
}

function isPhoneOtpConflict(msg: string, code: string): boolean {
  if (isCrossProviderOrIdentityConflict(msg, code)) return true;
  const m = msg.toLowerCase();
  if (/phone.*(already|registered|taken)|number.*(already|registered)/i.test(m)) return true;
  return false;
}

function mapOAuthProviderConflict(err: unknown, provider: 'google' | 'apple'): AuthConflictResult {
  const { msg, code } = normalize(err);
  if (!msg && !code) return { message: null, suggestEmailSignIn: false };

  if (isCrossProviderOrIdentityConflict(msg, code)) {
    return { message: AUTH_COPY.crossProvider, suggestEmailSignIn: false };
  }
  if (isUserAlreadyExists(msg, code)) {
    return {
      message: provider === 'google' ? AUTH_COPY.googleSignInWithGoogle : AUTH_COPY.appleSignInWithApple,
      suggestEmailSignIn: false,
    };
  }
  return { message: null, suggestEmailSignIn: false };
}

/**
 * Map Supabase / OAuth errors to explicit conflict copy. Returns null message when not a known conflict.
 */
export function mapAuthConflictError(err: unknown, context: AuthConflictContext): AuthConflictResult {
  const { msg, code } = normalize(err);
  if (!msg && !code) return { message: null, suggestEmailSignIn: false };

  if (context === 'email_sign_up') {
    const taken = isUserAlreadyExists(msg, code);
    if (!taken) return { message: null, suggestEmailSignIn: false };
    if (isCrossProviderOrIdentityConflict(msg, code)) {
      return { message: AUTH_COPY.crossProvider, suggestEmailSignIn: true };
    }
    return { message: AUTH_COPY.emailSignInInstead, suggestEmailSignIn: true };
  }

  if (context === 'email_sign_in') {
    if (/invalid login|invalid credentials|wrong password|email not confirmed/i.test(msg.toLowerCase())) {
      return { message: null, suggestEmailSignIn: false };
    }
    if (isCrossProviderOrIdentityConflict(msg, code)) {
      return { message: AUTH_COPY.crossProvider, suggestEmailSignIn: false };
    }
    return { message: null, suggestEmailSignIn: false };
  }

  if (context === 'phone_otp_send' || context === 'phone_otp_resend') {
    if (isPhoneOtpConflict(msg, code)) {
      return { message: AUTH_COPY.phoneSignInWithCode, suggestEmailSignIn: false };
    }
    return { message: null, suggestEmailSignIn: false };
  }

  if (context === 'google') {
    return mapOAuthProviderConflict(err, 'google');
  }

  if (context === 'apple') {
    return mapOAuthProviderConflict(err, 'apple');
  }

  return { message: null, suggestEmailSignIn: false };
}

/** Parse OAuth error from redirect URL (query or hash). */
export function parseOAuthCallbackErrorDescription(search: string, hash: string): string | null {
  try {
    const q = search.startsWith('?') ? search.slice(1) : search;
    const sp = new URLSearchParams(q);
    let desc = sp.get('error_description') || sp.get('error');
    if (!desc && hash) {
      const h = hash.startsWith('#') ? hash.slice(1) : hash;
      const hp = new URLSearchParams(h);
      desc = hp.get('error_description') || hp.get('error');
    }
    if (!desc) return null;
    try {
      return decodeURIComponent(desc.replace(/\+/g, ' '));
    } catch {
      return desc;
    }
  } catch {
    return null;
  }
}
