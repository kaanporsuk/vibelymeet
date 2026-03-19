import { usePathname } from 'expo-router';

// Global state for checking current route from outside React tree
let currentRoute = '/';

export function useCurrentRouteTracker(): string {
  const pathname = usePathname();
  currentRoute = pathname ?? '/';
  return currentRoute;
}

export function getCurrentRoute(): string {
  return currentRoute;
}
