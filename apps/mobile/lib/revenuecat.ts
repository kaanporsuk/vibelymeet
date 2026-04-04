/**
 * RevenueCat SDK wrapper for native premium/subscription.
 * Prefers platform-specific keys: EXPO_PUBLIC_REVENUECAT_IOS_API_KEY, EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY.
 * Falls back to EXPO_PUBLIC_REVENUECAT_API_KEY if platform key is unset (backward compatible).
 * Backend entitlement is synced via revenuecat-webhook and sync-revenuecat-subscriber Edge Function.
 */

import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  type PurchasesOfferings,
  type PurchasesPackage,
  PURCHASES_ERROR_CODE,
  type PurchasesError,
} from 'react-native-purchases';

let configured = false;

/**
 * Resolves the RevenueCat API key for the current platform.
 * Uses iOS/Android-specific env vars when set, otherwise EXPO_PUBLIC_REVENUECAT_API_KEY.
 */
export function getRevenueCatApiKey(): string {
  const generic = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY ?? '';
  if (Platform.OS === 'ios') {
    return (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? generic).trim();
  }
  if (Platform.OS === 'android') {
    return (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? generic).trim();
  }
  return generic.trim();
}

export function isRevenueCatConfigured(): boolean {
  return configured;
}

export function initRevenueCat(apiKey?: string): void {
  const key = (apiKey?.trim() ?? getRevenueCatApiKey()) || '';
  if (!key) return;
  try {
    Purchases.configure({ apiKey: key });
    configured = true;
  } catch (e) {
    configured = false;
    Sentry.captureException(e instanceof Error ? e : new Error(String(e)), {
      tags: { area: 'revenuecat_configure' },
    });
  }
}

export async function clearRevenueCatUser(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch {
    // best-effort
  }
}

export async function setRevenueCatUserId(userId: string): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logIn(userId);
  } catch {
    // best-effort
  }
}

export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!configured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    if (offerings?.current?.availablePackages?.length === 0) {
      if (__DEV__) {
        console.warn(
          '[RevenueCat] Default offering has no packages; subscription UI will show fallback. Configure products in RevenueCat dashboard.'
        );
      }
      return null;
    }
    return offerings;
  } catch (e) {
    if (__DEV__) {
      console.warn('[RevenueCat] getOfferings failed:', e instanceof Error ? e.message : String(e));
    }
    return null;
  }
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<{ success: boolean; error?: string }> {
  if (!configured) return { success: false, error: 'RevenueCat not configured' };
  try {
    const result = await Purchases.purchasePackage(pkg);
    const hasEntitlement = Object.keys(result.customerInfo.entitlements.active).length > 0;
    return { success: hasEntitlement };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
}

export type RestorePurchasesSdkResult =
  | { ok: true; customerInfo: CustomerInfo }
  | { ok: false; customerInfo: null; error: PurchasesError | Error; errorCode?: PURCHASES_ERROR_CODE };

/** Restore transactions and return CustomerInfo (or structured error). */
export async function restorePurchasesWithCustomerInfo(): Promise<RestorePurchasesSdkResult> {
  if (!configured) {
    return { ok: false, customerInfo: null, error: new Error('RevenueCat not configured') };
  }
  try {
    const customerInfo = await Purchases.restorePurchases();
    return { ok: true, customerInfo };
  } catch (e: unknown) {
    const pe = e as PurchasesError;
    const code = pe && typeof pe === 'object' && 'code' in pe ? (pe.code as PURCHASES_ERROR_CODE) : undefined;
    return {
      ok: false,
      customerInfo: null,
      error: pe instanceof Error ? pe : new Error(String(e)),
      errorCode: code,
    };
  }
}

/** @deprecated Prefer restorePurchasesWithCustomerInfo for tier handling. */
export async function restorePurchases(): Promise<{ success: boolean; error?: string }> {
  const r = await restorePurchasesWithCustomerInfo();
  if (r.ok) return { success: true };
  const msg = r.error instanceof Error ? r.error.message : String(r.error);
  return { success: false, error: msg };
}
