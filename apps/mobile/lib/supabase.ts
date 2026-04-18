import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  '';

const supabaseUrl = SUPABASE_URL;
const supabaseKey = SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[Vibely Mobile] EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY) must be set. Use .env or app.config.js.'
  );
}

export const SUPABASE_PROJECT_REF = (() => {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0]?.trim() || null;
  } catch {
    return null;
  }
})();

export const SUPABASE_AUTH_STORAGE_KEY = SUPABASE_PROJECT_REF
  ? `sb-${SUPABASE_PROJECT_REF}-auth-token`
  : null;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: AsyncStorage,
    lock: processLock,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
    ...(SUPABASE_AUTH_STORAGE_KEY ? { storageKey: SUPABASE_AUTH_STORAGE_KEY } : {}),
  },
});
