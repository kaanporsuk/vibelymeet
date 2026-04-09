import * as AppleAuthentication from 'expo-apple-authentication';

type UserMetadata = Record<string, unknown>;

type AppleNameMetadataPatch = Partial<{
  full_name: string;
  given_name: string;
  family_name: string;
}>;

const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function createAppleAuthNonce(size = 32): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random generation is unavailable on this device.');
  }

  const bytes = new Uint8Array(size);
  cryptoApi.getRandomValues(bytes);

  return Array.from(bytes, (byte) => NONCE_ALPHABET[byte % NONCE_ALPHABET.length]).join('');
}

export function normalizeAppleFullName(
  fullName: AppleAuthentication.AppleAuthenticationFullName | null | undefined,
): AppleNameMetadataPatch | null {
  const givenName = trimToNull(fullName?.givenName);
  const familyName = trimToNull(fullName?.familyName);
  const fullNameValue = trimToNull([givenName, familyName].filter(Boolean).join(' '));

  const patch: AppleNameMetadataPatch = {};
  if (fullNameValue) patch.full_name = fullNameValue;
  if (givenName) patch.given_name = givenName;
  if (familyName) patch.family_name = familyName;

  return Object.keys(patch).length > 0 ? patch : null;
}

export function buildAppleNameMetadataPatch(input: {
  existingMetadata: UserMetadata | null | undefined;
  fullName: AppleAuthentication.AppleAuthenticationFullName | null | undefined;
}): UserMetadata | null {
  const namePatch = normalizeAppleFullName(input.fullName);
  if (!namePatch) return null;
  return {
    ...(input.existingMetadata ?? {}),
    ...namePatch,
  };
}
