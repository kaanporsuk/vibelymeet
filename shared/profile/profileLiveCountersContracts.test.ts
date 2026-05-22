import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260522190000_profile_live_counter_read_model.sql");
const validation = read("supabase/validation/profile_live_counter_read_model.sql");
const webProfileStudio = read("src/pages/ProfileStudio.tsx");
const webApp = read("src/App.tsx");
const mobileProfileCountsRealtime = read("apps/mobile/lib/useProfileCountsRealtime.ts");
const mobileLayout = read("apps/mobile/app/_layout.tsx");
const mobileChatApi = read("apps/mobile/lib/chatApi.ts");

test("profile live counter migration maintains the profile read model from source tables", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.recompute_profile_live_counts\(p_profile_id uuid\)/);
  assert.match(migration, /FROM public\.event_registrations er[\s\S]*WHERE er\.profile_id = p_profile_id/);
  assert.match(migration, /FROM public\.matches m[\s\S]*m\.profile_id_1 = p_profile_id[\s\S]*m\.profile_id_2 = p_profile_id/);
  assert.match(migration, /count\(\*\) FILTER \(WHERE m\.last_message_at IS NOT NULL\)::integer/);
  assert.match(migration, /p\.events_attended IS DISTINCT FROM v_events/);
  assert.match(migration, /p\.total_matches IS DISTINCT FROM v_matches/);
  assert.match(migration, /p\.total_conversations IS DISTINCT FROM v_conversations/);

  assert.match(migration, /WITH counts AS \(/);
  assert.match(migration, /UPDATE public\.profiles p[\s\S]*events_attended = counts\.events_attended/);
  assert.match(migration, /total_matches = counts\.total_matches/);
  assert.match(migration, /total_conversations = counts\.total_conversations/);

  assert.match(migration, /CREATE TRIGGER trg_event_registrations_profile_live_counts[\s\S]*AFTER INSERT OR UPDATE OF profile_id OR DELETE ON public\.event_registrations/);
  assert.match(migration, /CREATE TRIGGER trg_matches_profile_live_counts[\s\S]*AFTER INSERT OR UPDATE OF profile_id_1, profile_id_2, last_message_at OR DELETE ON public\.matches/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.recompute_profile_live_counts\(uuid\) FROM PUBLIC, anon, authenticated;/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema';/);
});

test("profile live counter validation exercises backfill and trigger semantics", () => {
  for (const checkName of [
    "helper_recomputes_existing_rows",
    "event_registration_insert_updates_events",
    "event_registration_delete_updates_events",
    "event_registration_profile_transfer_updates_both_profiles",
    "match_insert_updates_both_profiles",
    "match_delete_updates_both_profiles",
    "last_message_at_set_updates_convos",
    "last_message_at_null_updates_convos",
  ]) {
    assert.match(validation, new RegExp(`'${checkName}'`));
  }

  assert.match(validation, /SELECT public\.recompute_profile_live_counts/);
  assert.match(validation, /INSERT INTO public\.event_registrations/);
  assert.match(validation, /DELETE FROM public\.event_registrations/);
  assert.match(validation, /INSERT INTO public\.matches/);
  assert.match(validation, /DELETE FROM public\.matches/);
  assert.match(validation, /UPDATE public\.matches[\s\S]*SET last_message_at = now\(\)/);
  assert.match(validation, /UPDATE public\.matches[\s\S]*SET last_message_at = NULL/);
  assert.match(validation, /ROLLBACK;/);
});

test("web profile studio renders maintained counters first and overlays live query data", () => {
  assert.match(webProfileStudio, /PROFILE_LIVE_COUNTS_STALE_TIME_MS/);
  assert.match(webProfileStudio, /const \{ data: liveCounts, dataUpdatedAt: liveCountsUpdatedAt \} = useQuery\(\{/);
  assert.match(webProfileStudio, /queryKey: profileUser\?\.id \? profileLiveCountsQueryKey\(profileUser\.id\) : profileLiveCountsQueryKey\("none"\)/);
  assert.match(webProfileStudio, /enabled: !!profileUser\?\.id && !!profile\.id/);
  assert.match(webProfileStudio, /const \[profileStatsLoadedAt, setProfileStatsLoadedAt\] = useState\(0\);/);
  assert.match(webProfileStudio, /staleTime: 0/);
  assert.match(webProfileStudio, /const profileLoadedAt = Date\.now\(\);/);
  assert.match(webProfileStudio, /setProfileStatsLoadedAt\(profileLoadedAt\);/);
  assert.match(webProfileStudio, /liveCounts && liveCountsUpdatedAt >= profileStatsLoadedAt \? liveCounts : null/);
  assert.match(webProfileStudio, /const profileDisplayStats = liveCountsFreshForLoadedProfile \?\? profile\.stats;/);
  assert.match(webProfileStudio, /\{ label: "Events", value: profileDisplayStats\.events \}/);
  assert.match(webProfileStudio, /\{ label: "Matches", value: profileDisplayStats\.matches \}/);
  assert.match(webProfileStudio, /\{ label: "Convos", value: profileDisplayStats\.conversations \}/);

  assert.doesNotMatch(webProfileStudio, /Error loading profile counts/);
  assert.doesNotMatch(webProfileStudio, /setProfile\(\(prev\) => \(prev\.id === data\.id \? \{ \.\.\.prev, stats: liveCounts \} : prev\)\)/);
});

test("web app invalidates profile counters from realtime source-table changes", () => {
  assert.match(webApp, /const WebProfileCountsInvalidator = \(\) => \{/);
  const profileCountsInvalidator = webApp.slice(
    webApp.indexOf("const WebProfileCountsInvalidator = () => {"),
    webApp.indexOf("const WebUploadRecoveryNotifier = () => {"),
  );
  assert.ok(profileCountsInvalidator.includes("const WebProfileCountsInvalidator = () => {"));
  assert.match(webApp, /queryClient\.invalidateQueries\(\{ queryKey: profileLiveCountsQueryKey\(userId\) \}\)/);
  assert.match(webApp, /queryClient\.invalidateQueries\(\{ queryKey: myProfileQueryKey\(userId\) \}\)/);
  assert.match(profileCountsInvalidator, /table: "event_registrations", filter: `profile_id=eq\.\$\{userId\}`/);
  assert.match(profileCountsInvalidator, /event: "UPDATE"[\s\S]*table: "profiles"[\s\S]*filter: `id=eq\.\$\{userId\}`/);
  assert.match(profileCountsInvalidator, /\[`profile_id_1=eq\.\$\{userId\}`, `profile_id_2=eq\.\$\{userId\}`\]/);
  assert.match(profileCountsInvalidator, /table: "matches", filter/);
  assert.match(profileCountsInvalidator, /event: "INSERT"[\s\S]*table: "messages"[\s\S]*invalidateProfileCounts/);
  assert.match(profileCountsInvalidator, /event: "UPDATE"[\s\S]*table: "messages"[\s\S]*invalidateProfileCounts/);
  assert.match(webApp, /<WebProfileCountsInvalidator \/>/);
});

test("native invalidates profile counters from source-table and message changes", () => {
  assert.match(mobileProfileCountsRealtime, /export function useProfileCountsRealtime\(userId: string \| null \| undefined\)/);
  assert.match(mobileProfileCountsRealtime, /queryClient\.invalidateQueries\(\{ queryKey: profileLiveCountsQueryKey\(userId\) \}\)/);
  assert.match(mobileProfileCountsRealtime, /queryClient\.invalidateQueries\(\{ queryKey: myProfileQueryKey\(userId\) \}\)/);
  assert.match(mobileProfileCountsRealtime, /table: 'event_registrations', filter: `profile_id=eq\.\$\{userId\}`/);
  assert.match(mobileProfileCountsRealtime, /event: 'UPDATE'[\s\S]*table: 'profiles'[\s\S]*filter: `id=eq\.\$\{userId\}`/);
  assert.match(mobileProfileCountsRealtime, /\[`profile_id_1=eq\.\$\{userId\}`, `profile_id_2=eq\.\$\{userId\}`\]/);
  assert.match(mobileProfileCountsRealtime, /table: 'matches', filter/);

  assert.match(mobileLayout, /import \{ useProfileCountsRealtime \} from '@\/lib\/useProfileCountsRealtime';/);
  assert.match(mobileLayout, /function ProfileCountsRealtimeUpdater\(\)/);
  assert.match(mobileLayout, /useProfileCountsRealtime\(user\?\.id\)/);
  assert.match(mobileLayout, /<ProfileCountsRealtimeUpdater \/>/);

  assert.match(mobileChatApi, /import \{ myProfileQueryKey, profileLiveCountsQueryKey \} from '@\/lib\/profileApi';/);
  assert.match(mobileChatApi, /queryKey: profileLiveCountsQueryKey\(userId\)/);
  assert.match(mobileChatApi, /queryKey: myProfileQueryKey\(userId\)/);
});
