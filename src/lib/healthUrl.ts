/** Supabase Edge Function `health` — used for connectivity probes only. */
export function getHealthUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL ?? "";
  if (!base) return "";
  return `${base.replace(/\/$/, "")}/functions/v1/health`;
}
