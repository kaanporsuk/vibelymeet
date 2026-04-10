import * as AppleAuthentication from 'expo-apple-authentication';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// guard:no-expo-crypto allow - Apple nonce helpers must not import `expo-crypto`.
// guard:no-expo-crypto allow - Loading it requires the native `ExpoCrypto` module at import time.
// Use `globalThis.crypto.getRandomValues` for entropy and `@noble/hashes` for SHA-256 hex.

type UserMetadata = Record<string, unknown>;

type AppleNameMetadataPatch = Partial<{
  full_name: string;
  given_name: string;
  family_name: string;
}>;

const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export type AppleAuthNoncePair = {
  rawNonce: string;
  hashedNonce: string;
};

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function createAppleAuthNonce(size = 32): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random generation is unavailable on this device.');
  }

  const bytes = new Uint8Array(size);
  cryptoApi.getRandomValues(bytes);

  return Array.from(bytes, (byte) => NONCE_ALPHABET[byte % NONCE_ALPHABET.length]).join('');
}

export async function createAppleAuthNoncePair(size = 32): Promise<AppleAuthNoncePair> {
  const rawNonce = createAppleAuthNonce(size);
  const hashedNonce = bytesToHex(sha256(new TextEncoder().encode(rawNonce)));
  return { rawNonce, hashedNonce };
}

function summarizeNonceForDebug(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return { exists: false, length: null, prefix: null };
  }

  return {
    exists: value.length > 0,
    length: value.length,
    prefix: value.length > 0 ? value.slice(0, 8) : null,
  };
}

export function logAppleNonceDebug(
  label: string,
  input: { rawNonce?: string | null; hashedNonce?: string | null },
) {
  if (!__DEV__) return;

  console.info('[auth][apple][nonce]', label, {
    rawNonce: summarizeNonceForDebug(input.rawNonce),
    hashedNonce: summarizeNonceForDebug(input.hashedNonce),
  });
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
