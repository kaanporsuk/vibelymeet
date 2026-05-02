import { useEntitlementsContext } from '@/context/EntitlementsContext';

export { getUserBadge } from '@shared/tiers';

export function useEntitlements() {
  return useEntitlementsContext();
}
