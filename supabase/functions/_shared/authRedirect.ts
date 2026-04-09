export type PasswordRecoveryStatus = 'none' | 'ready' | 'invalid' | 'success';

export type ParsedSupabaseAuthReturnUrl = {
  isValidUrl: boolean;
  pathname: string;
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenHash: string | null;
  authError: string | null;
  type: string | null;
  hasAuthPayload: boolean;
};

function emptyParsedAuthReturn(): ParsedSupabaseAuthReturnUrl {
  return {
    isValidUrl: false,
    pathname: '',
    code: null,
    accessToken: null,
    refreshToken: null,
    tokenHash: null,
    authError: null,
    type: null,
    hasAuthPayload: false,
  };
}

export function normalizeAuthRedirectPath(path: string | null | undefined): string {
  return String(path ?? '')
    .replace(/^\/+/, '')
    .replace(/^--\//, '')
    .replace(/\/+$/, '');
}

export function matchesAuthRedirectPath(
  path: string | null | undefined,
  expectedPath: string,
): boolean {
  const normalizedPath = normalizeAuthRedirectPath(path);
  const normalizedExpected = normalizeAuthRedirectPath(expectedPath);
  if (!normalizedPath || !normalizedExpected) return false;
  return (
    normalizedPath === normalizedExpected
    || normalizedPath.endsWith(`/${normalizedExpected}`)
  );
}

export function hasPasswordRecoveryIntent(
  type: string | null | undefined,
  pathCandidates: Array<string | null | undefined>,
): boolean {
  if (type === 'recovery') return true;
  return pathCandidates.some((path) => matchesAuthRedirectPath(path, 'reset-password'));
}

export function isPasswordRecoveryStatus(
  value: string | null | undefined,
): value is PasswordRecoveryStatus {
  return (
    value === 'none'
    || value === 'ready'
    || value === 'invalid'
    || value === 'success'
  );
}

export function parseSupabaseAuthReturnUrl(url: string): ParsedSupabaseAuthReturnUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return emptyParsedAuthReturn();
  }

  const searchParams = parsed.searchParams;
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));

  const code = searchParams.get('code') ?? hashParams.get('code');
  const accessToken =
    hashParams.get('access_token') ?? searchParams.get('access_token');
  const refreshToken =
    hashParams.get('refresh_token') ?? searchParams.get('refresh_token');
  const tokenHash =
    searchParams.get('token_hash') ?? hashParams.get('token_hash');
  const authError =
    hashParams.get('error_description')
    ?? searchParams.get('error_description')
    ?? hashParams.get('error')
    ?? searchParams.get('error');
  const type = hashParams.get('type') ?? searchParams.get('type');

  return {
    isValidUrl: true,
    pathname: parsed.pathname,
    code,
    accessToken,
    refreshToken,
    tokenHash,
    authError,
    type,
    hasAuthPayload: Boolean(
      authError
      || code
      || tokenHash
      || (accessToken && refreshToken),
    ),
  };
}
