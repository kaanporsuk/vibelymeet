import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_AUTH_STORAGE_KEY, SUPABASE_PROJECT_REF } from '@/lib/supabase';

const LEGACY_SUPABASE_AUTH_STORAGE_KEYS = [
  'supabase.auth.token',
];

function expandAuthStorageKey(baseKey: string): string[] {
  return [
    baseKey,
    `${baseKey}-user`,
    `${baseKey}-code-verifier`,
  ];
}

/**
 * Covers the current project-scoped Supabase auth key plus the older generic
 * React Native storage key family used before project namespacing.
 */
export function getNativeSupabaseAuthStorageKeys(): string[] {
  const keys = new Set<string>();

  if (SUPABASE_AUTH_STORAGE_KEY) {
    expandAuthStorageKey(SUPABASE_AUTH_STORAGE_KEY).forEach((key) => keys.add(key));
  }

  for (const legacyKey of LEGACY_SUPABASE_AUTH_STORAGE_KEYS) {
    expandAuthStorageKey(legacyKey).forEach((key) => keys.add(key));
  }

  if (SUPABASE_PROJECT_REF && !SUPABASE_AUTH_STORAGE_KEY) {
    expandAuthStorageKey(`sb-${SUPABASE_PROJECT_REF}-auth-token`).forEach((key) => keys.add(key));
  }

  return Array.from(keys);
}

export async function clearNativeSupabaseAuthStorage(): Promise<{
  clearedKeys: string[];
  failedKeys: string[];
}> {
  const keys = getNativeSupabaseAuthStorageKeys();

  try {
    await AsyncStorage.multiRemove(keys);
    return { clearedKeys: keys, failedKeys: [] };
  } catch {
    const results = await Promise.allSettled(keys.map((key) => AsyncStorage.removeItem(key)));
    const failedKeys = results.flatMap((result, index) =>
      result.status === 'rejected' ? [keys[index]] : []
    );

    return {
      clearedKeys: keys.filter((key) => !failedKeys.includes(key)),
      failedKeys,
    };
  }
}
