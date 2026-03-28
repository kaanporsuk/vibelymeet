/**
 * Vibely Subscription Tiers — Single Source of Truth
 *
 * THREE capability types:
 * 1. BOOLEAN — feature on/off
 * 2. QUOTA — numeric limit per cycle, null = unlimited
 * 3. ACCESS LEVEL — array of content tiers user can access
 */

export const TIER_IDS = ['free', 'premium', 'vip'] as const;
export type TierId = (typeof TIER_IDS)[number];

export interface BooleanCapabilities {
  canSeeLikedYou: boolean;
  canCityBrowse: boolean;
  canUseVibeSchedule: boolean;
  canSuggestDate: boolean;
  canAccessPremiumEvents: boolean;
  canAccessVipEvents: boolean;
  hasBadge: boolean;
}

export interface QuotaCapabilities {
  dailySwipeLimit: number | null;
  monthlyEventJoins: number | null;
  monthlyVideoDateCredits: number | null;
  maxActiveConversations: number | null;
  dailyDropPriority: number;
}

export interface AccessCapabilities {
  accessibleEventTiers: string[];
}

export interface TierDefinition {
  id: TierId;
  label: string;
  badgeType: 'premium' | 'vip' | null;
  boolean: BooleanCapabilities;
  quotas: QuotaCapabilities;
  access: AccessCapabilities;
}

export const TIERS: Record<TierId, TierDefinition> = {
  free: {
    id: 'free',
    label: 'Free',
    badgeType: null,
    boolean: {
      canSeeLikedYou: false,
      canCityBrowse: false,
      canUseVibeSchedule: true,
      canSuggestDate: true,
      canAccessPremiumEvents: false,
      canAccessVipEvents: false,
      hasBadge: false,
    },
    quotas: {
      dailySwipeLimit: null,
      monthlyEventJoins: null,
      monthlyVideoDateCredits: 0,
      maxActiveConversations: null,
      dailyDropPriority: 0,
    },
    access: {
      accessibleEventTiers: ['free'],
    },
  },
  premium: {
    id: 'premium',
    label: 'Premium',
    badgeType: 'premium',
    boolean: {
      canSeeLikedYou: true,
      canCityBrowse: true,
      canUseVibeSchedule: true,
      canSuggestDate: true,
      canAccessPremiumEvents: true,
      canAccessVipEvents: false,
      hasBadge: true,
    },
    quotas: {
      dailySwipeLimit: null,
      monthlyEventJoins: null,
      monthlyVideoDateCredits: 3,
      maxActiveConversations: null,
      dailyDropPriority: 1,
    },
    access: {
      accessibleEventTiers: ['free', 'premium'],
    },
  },
  vip: {
    id: 'vip',
    label: 'VIP',
    badgeType: 'vip',
    boolean: {
      canSeeLikedYou: true,
      canCityBrowse: true,
      canUseVibeSchedule: true,
      canSuggestDate: true,
      canAccessPremiumEvents: true,
      canAccessVipEvents: true,
      hasBadge: true,
    },
    quotas: {
      dailySwipeLimit: null,
      monthlyEventJoins: null,
      monthlyVideoDateCredits: null,
      maxActiveConversations: null,
      dailyDropPriority: 2,
    },
    access: {
      accessibleEventTiers: ['free', 'premium', 'vip'],
    },
  },
};

export function getTierDefinition(tierId: string | null | undefined): TierDefinition {
  if (tierId && tierId in TIERS) return TIERS[tierId as TierId];
  return TIERS.free;
}

export type FlatCapabilities = BooleanCapabilities & QuotaCapabilities & AccessCapabilities & {
  tierId: TierId;
  tierLabel: string;
  badgeType: 'premium' | 'vip' | null;
  isPremium: boolean;
};

export function getFlatCapabilities(tierId: string | null | undefined): FlatCapabilities {
  const def = getTierDefinition(tierId);
  return {
    tierId: def.id,
    tierLabel: def.label,
    badgeType: def.badgeType,
    isPremium: def.id !== 'free',
    ...def.boolean,
    ...def.quotas,
    ...def.access,
  };
}

export function canAccessEventTier(
  userTierId: string | null | undefined,
  eventVisibility: string | null | undefined
): boolean {
  const caps = getFlatCapabilities(userTierId);
  return caps.accessibleEventTiers.includes(eventVisibility || 'free');
}

export function getUserBadge(
  subscriptionTier: string | null | undefined
): 'premium' | 'vip' | null {
  return getFlatCapabilities(subscriptionTier).badgeType;
}

// ── Runtime override merging ──────────────────────────────────────

export interface TierConfigOverride {
  tier_id: string;
  capability_key: string;
  value: unknown;
}

export interface CapabilityMeta {
  key: string;
  label: string;
  type: 'boolean' | 'number' | 'number_or_null' | 'string_array';
  category: 'boolean' | 'quota' | 'access';
  description: string;
}

export const CAPABILITY_REGISTRY: CapabilityMeta[] = [
  { key: 'canSeeLikedYou', label: 'See who vibed you', type: 'boolean', category: 'boolean', description: 'Unblur profiles of users who liked them' },
  { key: 'canCityBrowse', label: 'Browse events in any city', type: 'boolean', category: 'boolean', description: 'Search events outside nearby area' },
  { key: 'canUseVibeSchedule', label: 'Vibe Schedule', type: 'boolean', category: 'boolean', description: 'Access the Vibe Schedule feature' },
  { key: 'canSuggestDate', label: 'Suggest a Date', type: 'boolean', category: 'boolean', description: 'Send date suggestions in chat' },
  { key: 'canAccessPremiumEvents', label: 'Premium events', type: 'boolean', category: 'boolean', description: 'See and register for premium-tier events' },
  { key: 'canAccessVipEvents', label: 'VIP events', type: 'boolean', category: 'boolean', description: 'See and register for VIP-tier events' },
  { key: 'hasBadge', label: 'Profile badge', type: 'boolean', category: 'boolean', description: 'Show a tier badge on profile' },
  { key: 'dailySwipeLimit', label: 'Daily swipe limit', type: 'number_or_null', category: 'quota', description: 'Max swipes per day (empty = unlimited)' },
  { key: 'monthlyEventJoins', label: 'Monthly event joins', type: 'number_or_null', category: 'quota', description: 'Max event registrations per month (empty = unlimited)' },
  { key: 'monthlyVideoDateCredits', label: 'Monthly video credits', type: 'number_or_null', category: 'quota', description: 'Free video date credits per month (empty = unlimited)' },
  { key: 'maxActiveConversations', label: 'Max conversations', type: 'number_or_null', category: 'quota', description: 'Max active conversations (empty = unlimited)' },
  { key: 'dailyDropPriority', label: 'Daily Drop priority', type: 'number', category: 'quota', description: 'Priority weight for Daily Drop (higher = matched first)' },
  { key: 'accessibleEventTiers', label: 'Event tier access', type: 'string_array', category: 'access', description: 'Which event visibility levels accessible' },
];

const OVERRIDABLE_KEYS = new Set(CAPABILITY_REGISTRY.map((c) => c.key));

export function coerceOverrideValue(meta: CapabilityMeta, raw: unknown): unknown {
  switch (meta.type) {
    case 'boolean': return raw === true || raw === 'true';
    case 'number': {
      if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
      if (typeof raw === 'string' && raw.trim() !== '') {
        const n = Number(raw);
        return Number.isNaN(n) ? 0 : n;
      }
      return 0;
    }
    case 'number_or_null':
      if (raw === null || raw === undefined) return null;
      if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
      if (typeof raw === 'string') {
        if (raw.trim() === '') return null;
        const n = Number(raw);
        return Number.isNaN(n) ? null : n;
      }
      return null;
    case 'string_array':
      if (!Array.isArray(raw)) return [];
      return raw.filter((x): x is string => typeof x === 'string');
    default: return raw;
  }
}

export function getCapabilityDefaultForTier(tierId: TierId, capabilityKey: string): unknown {
  const def = getTierDefinition(tierId);
  if (capabilityKey in def.boolean) return def.boolean[capabilityKey as keyof BooleanCapabilities];
  if (capabilityKey in def.quotas) return def.quotas[capabilityKey as keyof QuotaCapabilities];
  if (capabilityKey in def.access) return def.access[capabilityKey as keyof AccessCapabilities];
  return undefined;
}

export function mergeTierWithOverrides(
  tierId: string | null | undefined,
  overrides: TierConfigOverride[]
): FlatCapabilities {
  const base = getFlatCapabilities(tierId);
  const tid = (tierId && tierId in TIERS ? tierId : 'free') as TierId;
  const tierOverrides = overrides.filter((o) => o.tier_id === tid);
  const merged = { ...base } as Record<string, unknown>;
  for (const override of tierOverrides) {
    if (!OVERRIDABLE_KEYS.has(override.capability_key)) continue;
    const meta = CAPABILITY_REGISTRY.find((m) => m.key === override.capability_key);
    if (!meta) continue;
    merged[override.capability_key] = coerceOverrideValue(meta, override.value);
  }
  const out = merged as unknown as FlatCapabilities;
  out.isPremium = out.tierId !== 'free';
  return out;
}

export function getAllTiersWithOverrides(
  overrides: TierConfigOverride[]
): Record<TierId, { capabilities: FlatCapabilities; overriddenKeys: Set<string> }> {
  const result = {} as Record<TierId, { capabilities: FlatCapabilities; overriddenKeys: Set<string> }>;
  for (const id of TIER_IDS) {
    const tierOverrides = overrides.filter((o) => o.tier_id === id);
    result[id] = {
      capabilities: mergeTierWithOverrides(id, overrides),
      overriddenKeys: new Set(tierOverrides.map((o) => o.capability_key)),
    };
  }
  return result;
}
