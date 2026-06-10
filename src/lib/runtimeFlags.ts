const viteEnv = (
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
) as Record<string, string | undefined>;

function readLocalStorageFlag(key: string): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    if (value === "true" || value === "1" || value === "on") return true;
    if (value === "false" || value === "0" || value === "off") return false;
    return null;
  } catch {
    return null;
  }
}

function readBooleanFlag(envName: string, storageKey: string, defaultValue: boolean): boolean {
  const localValue = readLocalStorageFlag(storageKey);
  if (localValue !== null) return localValue;

  const envValue = viteEnv[envName];
  if (envValue === "true" || envValue === "1" || envValue === "on") return true;
  if (envValue === "false" || envValue === "0" || envValue === "off") return false;

  return defaultValue;
}

export function isSpeedInsightsDateRouteSuppressed(): boolean {
  return readBooleanFlag(
    "VITE_SUPPRESS_SPEED_INSIGHTS_ON_DATE_ROUTE",
    "vibely.suppress_speed_insights_on_date_route",
    false,
  );
}
