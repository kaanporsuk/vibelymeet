export const CREDIT_PACK_IDS = ['extra_time_3', 'extended_vibe_3', 'bundle_3_3'] as const;
export type CreditPackId = (typeof CREDIT_PACK_IDS)[number];

export interface CreditPackDef {
  name: string;
  description: string;
  priceEur: number;
  compareAtEur?: number;
  grants: { extra_time_credits: number; extended_vibe_credits: number };
}

export const CREDIT_PACKS: Record<CreditPackId, CreditPackDef> = {
  extra_time_3: {
    name: '3× Extra Time',
    description: 'Extend your video date by +2 min, 3 times',
    priceEur: 2.99,
    grants: { extra_time_credits: 3, extended_vibe_credits: 0 },
  },
  extended_vibe_3: {
    name: '3× Extended Vibe',
    description: 'Extend your video date by +5 min, 3 times',
    priceEur: 4.99,
    grants: { extra_time_credits: 0, extended_vibe_credits: 3 },
  },
  bundle_3_3: {
    name: 'Vibe Bundle',
    description: '3× Extra Time (+2 min) + 3× Extended Vibe (+5 min)',
    priceEur: 5.99,
    compareAtEur: 7.98,
    grants: { extra_time_credits: 3, extended_vibe_credits: 3 },
  },
};

export function getCreditPack(packId: string): CreditPackDef | null {
  if (packId in CREDIT_PACKS) return CREDIT_PACKS[packId as CreditPackId];
  return null;
}

export function formatPackPriceEur(priceEur: number): string {
  return `€${priceEur.toFixed(2)}`;
}
