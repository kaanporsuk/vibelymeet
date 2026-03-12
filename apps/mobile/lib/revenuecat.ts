/**
 * RevenueCat SDK wrapper for native premium/subscription.
 * Prefers platform-specific keys: EXPO_PUBLIC_REVENUECAT_IOS_API_KEY, EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY.
 * Falls back to EXPO_PUBLIC_REVENUECAT_API_KEY if platform key is unset (backward compatible).
 * Backend entitlement is synced via revenuecat-webhook Edge Function; mobile reads canonical state from backend after purchase.
 */

import { Platform } from 'react-native';
import Purchases, { type PurchasesOfferings, type PurchasesPackage } from 'react-native-purchases'

let configured = false

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
  return configured
}

export function initRevenueCat(apiKey?: string): void {
  const key = (apiKey?.trim() ?? getRevenueCatApiKey()) || '';
  if (!key) return
  try {
    Purchases.configure({ apiKey: key })
    configured = true
  } catch {
    configured = false
  }
}

export async function setRevenueCatUserId(userId: string): Promise<void> {
  if (!configured) return
  try {
    await Purchases.logIn(userId)
  } catch {
    // best-effort
  }
}

export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!configured) return null
  try {
    return await Purchases.getOfferings()
  } catch {
    return null
  }
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<{ success: boolean; error?: string }> {
  if (!configured) return { success: false, error: 'RevenueCat not configured' }
  try {
    const result = await Purchases.purchasePackage(pkg)
    const hasEntitlement = Object.keys(result.customerInfo.entitlements.active).length > 0
    return { success: hasEntitlement }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { success: false, error: message }
  }
}

export async function restorePurchases(): Promise<{ success: boolean; error?: string }> {
  if (!configured) return { success: false, error: 'RevenueCat not configured' }
  try {
    await Purchases.restorePurchases()
    return { success: true }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { success: false, error: message }
  }
}
