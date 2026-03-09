import * as Sentry from "@sentry/react";

export const captureSupabaseError = (operation: string, error: unknown) => {
  console.error(`Supabase error in ${operation}:`, error);
  Sentry.captureException(error, {
    tags: { source: "supabase", operation },
  });
};
