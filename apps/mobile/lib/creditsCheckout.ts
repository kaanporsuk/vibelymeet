/**
 * Create Stripe checkout session for credit packs (create-credits-checkout EF).
 * Returns checkout URL; open in browser. Same contract as web.
 */
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
/** Origin for redirect URLs (create-credits-checkout uses req.headers.get('origin')). Web sends it automatically; mobile must set it so success/cancel URLs point to the web app. */
const APP_ORIGIN = process.env.EXPO_PUBLIC_APP_ORIGIN ?? 'https://vibelymeet.com';

export type CreditPackId = 'extra_time_3' | 'extended_vibe_3' | 'bundle_3_3';

export async function getCreditsCheckoutUrl(packId: CreditPackId): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-credits-checkout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      Origin: APP_ORIGIN,
    },
    body: JSON.stringify({ packId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success || !data.url) throw new Error(data.error ?? 'Could not start checkout');
  return data.url;
}
