import { supabase } from '@/lib/supabase';

export type SyncRevenueCatSubscriberResult =
  | { ok: true; synced: boolean; active?: boolean }
  | { ok: false; error: string };

/**
 * Server-side pull from RevenueCat REST API into subscriptions + profile (service role).
 * No-op success when REVENUECAT_SECRET_API_KEY is not set on the project (synced: false).
 */
export async function syncRevenueCatSubscriberFromServer(): Promise<SyncRevenueCatSubscriberResult> {
  const { data, error } = await supabase.functions.invoke<{
    success?: boolean;
    synced?: boolean;
    active?: boolean;
    error?: string;
  }>('sync-revenuecat-subscriber', { body: {} });

  if (error) {
    return { ok: false, error: error.message };
  }
  if (data?.success === false) {
    return { ok: false, error: data.error ?? 'sync_failed' };
  }
  return { ok: true, synced: data?.synced !== false, active: data?.active };
}
