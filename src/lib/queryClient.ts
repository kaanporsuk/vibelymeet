/**
 * Shared QueryClient singleton — imported by App.tsx (provider) and the
 * hero-video upload controller (invalidation after terminal state).
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});
