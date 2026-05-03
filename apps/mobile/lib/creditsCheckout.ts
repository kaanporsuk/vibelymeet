/**
 * Create Stripe checkout session for credit packs (create-credits-checkout EF).
 * Returns checkout URL; open in browser. Same contract as web.
 */
import { getCachedAccessToken } from '@/lib/nativeAuthSession';
import type { CreditPackId } from '@shared/creditPacks';

export type { CreditPackId };

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
/** Origin for redirect URLs (create-credits-checkout uses req.headers.get('origin')). Web sends it automatically; mobile must set it so success/cancel URLs point to the web app. */
const APP_ORIGIN = process.env.EXPO_PUBLIC_APP_ORIGIN ?? 'https://www.vibelymeet.com';

export async function getCreditsCheckoutUrl(packId: CreditPackId): Promise<string> {
  const accessToken = await getCachedAccessToken();
  if (!accessToken) throw new Error('Not authenticated');

  if (!SUPABASE_URL) {
    throw new Error('[creditsCheckout] EXPO_PUBLIC_SUPABASE_URL is not set. Check your .env file.');
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-credits-checkout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Origin: APP_ORIGIN,
    },
    body: JSON.stringify({ packId }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error ?? `Checkout failed (HTTP ${res.status})`);
  }

  const data = await res.json();
  if (!data.success || !data.url) throw new Error(data.error ?? 'Could not start checkout');
  return data.url;
}
