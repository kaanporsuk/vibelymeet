import test from 'node:test';
import assert from 'node:assert/strict';

import {
  authErrorDebugInfo,
  authErrorStatus,
  mapPhoneOtpSendError,
  safeAuthErrorMessage,
  safeIdentityLinkingErrorMessage,
} from './authErrorCopy';

function retryableAuthError(message: string, status?: number) {
  const error = new Error(message) as Error & { name: string; status?: number; code?: string };
  error.name = 'AuthRetryableFetchError';
  if (status !== undefined) error.status = status;
  return error;
}

test('phone OTP copy hides React Native response dumps from Supabase 504s', () => {
  const rawResponse = JSON.stringify({
    type: 'default',
    status: 504,
    ok: false,
    headers: { map: { 'cf-cache-status': 'DYNAMIC', 'set-cookie': 'secret-cookie-value' } },
    url: 'https://example.supabase.co/auth/v1/otp',
    bodyInit: { _data: { name: 'otp.txt', type: 'text/plain' } },
  });
  const error = retryableAuthError(rawResponse, 504);

  assert.equal(authErrorStatus(error), 504);
  assert.equal(
    mapPhoneOtpSendError(error),
    'SMS sign-in is temporarily unavailable. Try again in a moment, or use email instead.',
  );
  assert.equal(
    safeAuthErrorMessage(error, 'Could not sign in.'),
    'The authentication service is temporarily unavailable. Try again in a moment.',
  );
  assert.deepEqual(authErrorDebugInfo(error), {
    name: 'AuthRetryableFetchError',
    code: null,
    status: 504,
    messagePreview: '<raw auth response 504>',
  });
});

test('phone OTP copy handles browser-style Supabase retryable errors', () => {
  assert.equal(
    safeAuthErrorMessage(retryableAuthError('{}', 503), 'Could not sign in.'),
    'The authentication service is temporarily unavailable. Try again in a moment.',
  );
  assert.equal(
    mapPhoneOtpSendError(retryableAuthError('{}', 503)),
    'SMS sign-in is temporarily unavailable. Try again in a moment, or use email instead.',
  );
});

test('auth copy hides unhelpful payloads and OAuth machine codes', () => {
  assert.equal(
    safeAuthErrorMessage('{}', 'Could not complete sign-in. Try again.'),
    'Could not complete sign-in. Try again.',
  );
  assert.equal(
    safeAuthErrorMessage('access_denied', 'Could not complete sign-in. Try again.'),
    'Could not complete sign-in. Try again.',
  );
  assert.equal(
    safeAuthErrorMessage('Invalid login credentials', 'Sign in failed.'),
    'Invalid login credentials',
  );
  assert.deepEqual(authErrorDebugInfo(new Error('{"error":"server_error"}')), {
    name: 'Error',
    code: null,
    status: null,
    messagePreview: '<auth error payload>',
  });
});

test('phone OTP copy keeps specific actionable auth errors', () => {
  assert.equal(
    mapPhoneOtpSendError(new Error('Invalid phone number format. Use E.164.')),
    "That number doesn't look valid for the selected country. Use digits only and skip the leading 0.",
  );
  assert.equal(
    mapPhoneOtpSendError(retryableAuthError('Network request failed', 0)),
    "Couldn't reach Vibely. Check your connection and try again.",
  );
  assert.equal(
    mapPhoneOtpSendError(retryableAuthError('Too many requests', 429)),
    'Too many attempts. Wait a few minutes, then try again.',
  );
});

test('identity-linking copy preserves operation-specific fallbacks', () => {
  assert.equal(
    safeIdentityLinkingErrorMessage({}, 'email', 'Failed to set password.'),
    'Failed to set password.',
  );
  assert.equal(
    safeIdentityLinkingErrorMessage(
      retryableAuthError('{}', 503),
      'phone',
      'Failed to send verification code.',
    ),
    'The authentication service is temporarily unavailable. Try again in a moment.',
  );
  assert.equal(
    safeIdentityLinkingErrorMessage(
      new Error('identity is already linked to a different user'),
      'google',
      'Failed to link Google.',
    ),
    'This sign-in method is already connected to a different Vibely account. Sign in with that account to use it.',
  );
});
