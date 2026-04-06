/**
 * Settings-screen membership DISPLAY helpers (web + native).
 *
 * NOT used for entitlement enforcement — server RPCs and RLS remain authoritative.
 *
 * Display precedence — plan label (chip / “Vibely {x}”):
 * 1. subscription_tier (via useEntitlements → tierId / tierLabel): when tierId !== 'free', show tierLabel
 *    (Premium vs VIP comes from profiles.subscription_tier + shared/tiers).
 * 2. Else if billable subscription row is active/trialing: show "Member" — billing is live but profile tier
 *    may lag webhook/sync; avoid mislabeling VIP vs Premium.
 * 3. Else if premium_until is in the future (timed/admin grant, typically no Stripe portal): show "Premium"
 *    as short copy (tier column is usually aligned; this covers legacy edge cases).
 * 4. Else: "Free" (callers often hide the elevated card entirely when not showSettingsMemberElevated).
 *
 * Billing management (Stripe portal): only when hasBillableSubscription — requires an active/trialing row
 * in `subscriptions`.
 *
 * Access date line (secondary text):
 * - "Renews …" from subscription current_period_end when hasBillableSubscription.
 * - "Access through …" from premium_until when there is no billable sub but the grant is still active.
 */

export type SettingsMembershipDisplayInput = {
  tierId: string;
  tierLabel: string;
  hasBillableSubscription: boolean;
  subscriptionPeriodEndIso: string | null;
  premiumUntil: Date | null;
  /** Inject for tests; defaults to new Date() */
  now?: Date;
};

export function getSettingsPlanLabel(i: SettingsMembershipDisplayInput): string {
  const now = i.now ?? new Date();
  if (i.tierId !== 'free') return i.tierLabel;
  if (i.hasBillableSubscription) return 'Member';
  if (i.premiumUntil != null && i.premiumUntil > now) return 'Premium';
  return 'Free';
}

export type SettingsAccessDateLine =
  | { kind: 'renews'; iso: string }
  | { kind: 'access_through'; iso: string };

export function getSettingsAccessDateLine(
  i: SettingsMembershipDisplayInput
): SettingsAccessDateLine | null {
  const now = i.now ?? new Date();
  if (i.hasBillableSubscription && i.subscriptionPeriodEndIso) {
    return { kind: 'renews', iso: i.subscriptionPeriodEndIso };
  }
  if (!i.hasBillableSubscription && i.premiumUntil != null && i.premiumUntil > now) {
    return { kind: 'access_through', iso: i.premiumUntil.toISOString() };
  }
  return null;
}

/** True when we should show the elevated “member” settings card (not the upgrade CTA). */
export function showSettingsMemberElevated(i: SettingsMembershipDisplayInput): boolean {
  const now = i.now ?? new Date();
  if (i.tierId !== 'free') return true;
  if (i.hasBillableSubscription) return true;
  if (i.premiumUntil != null && i.premiumUntil > now) return true;
  return false;
}
