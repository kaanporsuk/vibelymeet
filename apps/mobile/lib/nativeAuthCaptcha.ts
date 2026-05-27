import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

const WEB_APP_ORIGIN = (process.env.EXPO_PUBLIC_WEB_APP_URL ?? 'https://www.vibelymeet.com').replace(/\/$/, '');
const AUTH_CAPTCHA_CALLBACK_PATH = 'auth/captcha';

export type NativeAuthCaptchaResult =
  | { ok: true; token: string | null }
  | { ok: false; message: string };

function getNativeAuthCaptchaReturnUrl(): string {
  return Linking.createURL(AUTH_CAPTCHA_CALLBACK_PATH);
}

function getNativeAuthCaptchaChallengeUrl(returnTo: string, action: string): string {
  const url = new URL('/auth/challenge', WEB_APP_ORIGIN);
  url.searchParams.set('return_to', returnTo);
  url.searchParams.set('action', action);
  return url.toString();
}

function isExpoDevReturnUrl(url: string): boolean {
  return url.startsWith('exp://') || url.startsWith('exps://');
}

function isLocalChallengeOrigin(): boolean {
  try {
    const { hostname } = new URL(WEB_APP_ORIGIN);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local');
  } catch {
    return false;
  }
}

function parseCaptchaTokenFromReturn(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('captchaToken')?.trim() || null;
  } catch {
    return null;
  }
}

export async function requestNativeAuthCaptchaToken(action: string): Promise<NativeAuthCaptchaResult> {
  const returnUrl = getNativeAuthCaptchaReturnUrl();
  if (isExpoDevReturnUrl(returnUrl) && !isLocalChallengeOrigin()) {
    if (!__DEV__) {
      return {
        ok: false,
        message: 'Verification is not available in this build. Install the latest app and try again.',
      };
    }
    return { ok: true, token: null };
  }

  const challengeUrl = getNativeAuthCaptchaChallengeUrl(returnUrl, action);

  try {
    const result = await WebBrowser.openAuthSessionAsync(challengeUrl, returnUrl);
    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { ok: false, message: 'Verification was cancelled.' };
    }
    if (result.type !== 'success') {
      return { ok: false, message: 'Verification could not be completed. Please try again.' };
    }
    return { ok: true, token: parseCaptchaTokenFromReturn(result.url) };
  } catch {
    return { ok: false, message: 'Verification could not be completed. Please try again.' };
  }
}
