const realtimeRequired = [
  "VIDEO_DATE_RLS_SUPABASE_URL",
  "VIDEO_DATE_RLS_SUPABASE_ANON_KEY",
  "VIDEO_DATE_RLS_SESSION_ID",
  "VIDEO_DATE_RLS_PARTICIPANT_JWT",
  "VIDEO_DATE_RLS_NON_PARTICIPANT_JWT",
];

const publicApiRequired = [
  "VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_URL",
  "VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_ANON_KEY",
  "VIDEO_DATE_PUBLIC_API_RLS_EVENT_ID",
  "VIDEO_DATE_PUBLIC_API_RLS_USER_ID",
  "VIDEO_DATE_PUBLIC_API_RLS_OTHER_USER_ID",
  "VIDEO_DATE_PUBLIC_API_RLS_PARTICIPANT_JWT",
  "VIDEO_DATE_PUBLIC_API_RLS_NON_PARTICIPANT_JWT",
  "VIDEO_DATE_PUBLIC_API_RLS_SESSION_ID",
];

const fallbackAliases = {
  VIDEO_DATE_RLS_SUPABASE_URL: ["SUPABASE_URL"],
  VIDEO_DATE_RLS_SUPABASE_ANON_KEY: ["SUPABASE_ANON_KEY"],
  VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_URL: ["SUPABASE_URL"],
  VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_ANON_KEY: ["SUPABASE_ANON_KEY"],
};

function hasValue(name) {
  if (process.env[name]?.trim()) return true;
  return (fallbackAliases[name] ?? []).some((alias) => process.env[alias]?.trim());
}

const missing = [...realtimeRequired, ...publicApiRequired].filter((name) => !hasValue(name));

if (missing.length > 0) {
  console.error("Missing required Video Date runtime RLS env vars:");
  for (const name of missing) console.error(`- ${name}`);
  console.error(
    "Set the VIDEO_DATE_RLS_* and VIDEO_DATE_PUBLIC_API_RLS_* variables before running npm run test:video-date-runtime-rls:required.",
  );
  process.exit(1);
}

console.log("Video Date runtime RLS env guard passed.");
