export type FeatureFlagAliasLike = {
  enabled?: boolean;
  source?: string | null;
};

export function isFeatureFlagEnabledWithAlias(
  canonical: FeatureFlagAliasLike | null | undefined,
  alias: FeatureFlagAliasLike | null | undefined,
): boolean {
  if (canonical?.source === "kill_switched") return false;
  return canonical?.enabled === true || alias?.enabled === true;
}
