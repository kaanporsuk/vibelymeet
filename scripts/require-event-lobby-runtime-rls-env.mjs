const required = [
  "EVENT_LOBBY_RLS_SUPABASE_URL",
  "EVENT_LOBBY_RLS_SUPABASE_ANON_KEY",
  "EVENT_LOBBY_RLS_EVENT_ID",
  "EVENT_LOBBY_RLS_USER_ID",
  "EVENT_LOBBY_RLS_PARTICIPANT_JWT",
];

const fallbackAliases = {
  EVENT_LOBBY_RLS_SUPABASE_URL: ["SUPABASE_URL"],
  EVENT_LOBBY_RLS_SUPABASE_ANON_KEY: ["SUPABASE_ANON_KEY"],
};

function hasValue(name) {
  if (process.env[name]?.trim()) return true;
  return (fallbackAliases[name] ?? []).some((alias) => process.env[alias]?.trim());
}

const missing = required.filter((name) => !hasValue(name));

if (missing.length > 0) {
  console.error("Missing required Event Lobby runtime RLS env vars:");
  for (const name of missing) console.error(`- ${name}`);
  console.error(
    "Set EVENT_LOBBY_RLS_* variables before running npm run test:event-lobby-runtime-rls:required.",
  );
  process.exit(1);
}

console.log("Event Lobby runtime RLS env guard passed.");
