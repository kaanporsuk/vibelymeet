import { useEntitlementsContext } from "@/contexts/EntitlementsContext";

export { getUserBadge } from "@shared/tiers";

export function useEntitlements() {
  return useEntitlementsContext();
}
