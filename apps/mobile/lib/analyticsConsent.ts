import AsyncStorage from '@react-native-async-storage/async-storage';
import { setRuntimeAnalyticsConsent } from '@/lib/analytics';

export type NativeAnalyticsConsentState = 'unset' | 'granted' | 'denied';

const ANALYTICS_CONSENT_STORAGE_KEY = 'vibely.analytics_consent.v1';
const listeners = new Set<(state: NativeAnalyticsConsentState) => void>();

function notify(state: NativeAnalyticsConsentState) {
  listeners.forEach((listener) => listener(state));
}

export async function loadNativeAnalyticsConsent(): Promise<NativeAnalyticsConsentState> {
  try {
    const value = await AsyncStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    if (value === 'granted' || value === 'denied') return value;
  } catch {
    /* consent storage must never block app boot */
  }
  return 'unset';
}

export async function saveNativeAnalyticsConsent(granted: boolean): Promise<void> {
  const next: NativeAnalyticsConsentState = granted ? 'granted' : 'denied';
  setRuntimeAnalyticsConsent(granted);
  notify(next);
  try {
    await AsyncStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, next);
  } catch {
    /* runtime consent still applies for this session */
  }
}

export async function hydrateRuntimeAnalyticsConsent(): Promise<NativeAnalyticsConsentState> {
  const state = await loadNativeAnalyticsConsent();
  setRuntimeAnalyticsConsent(state === 'granted');
  return state;
}

export function subscribeNativeAnalyticsConsent(
  listener: (state: NativeAnalyticsConsentState) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
