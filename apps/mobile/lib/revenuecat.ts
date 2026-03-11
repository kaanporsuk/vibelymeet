/**
 * RevenueCat SDK wrapper for native premium/subscription.
 * Requires EXPO_PUBLIC_REVENUECAT_API_KEY (iOS and/or Android key from RevenueCat dashboard).
 * Backend entitlement is synced via revenuecat-webhook Edge Function; mobile reads canonical state from backend after purchase.
 */

import Purchases, { type PurchasesOfferings, type PurchasesPackage } from 'react-native-purchases'

let configured = false

export function isRevenueCatConfigured(): boolean {
  return configured
}

export function initRevenueCat(apiKey: string | undefined): void {
  if (!apiKey?.trim()) return
  try {
    Purchases.configure({ apiKey: apiKey.trim() })
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
