-- Activity Status privacy verification.
--
-- Run only against a local or staging database after applying:
--   supabase/migrations/20260430201000_activity_status_privacy_boundary.sql
--
-- psql example:
--   psql "$STAGING_DB_URL" \
--     -v viewer_match="'00000000-0000-0000-0000-000000000001'" \
--     -v viewer_non_match="'00000000-0000-0000-0000-000000000002'" \
--     -v target="'00000000-0000-0000-0000-000000000003'" \
--     -v shared_event="'00000000-0000-0000-0000-000000000004'" \
--     -v match_id="'00000000-0000-0000-0000-000000000005'" \
--     -f docs/activity-status-privacy-verification.sql

begin;

-- MATCHES: established match can see presence.
set local role service_role;
update public.profiles
set activity_status_visibility = 'matches', last_seen_at = now()
where id = :target;

set local role authenticated;
select set_config('request.jwt.claim.sub', :viewer_match, true);
select *
from public.get_profile_presence_for_viewer(:target, null);
select *
from public.get_chat_partner_presence(:match_id);

-- MATCHES: non-match cannot see presence.
select set_config('request.jwt.claim.sub', :viewer_non_match, true);
select *
from public.get_profile_presence_for_viewer(:target, null);

-- NOBODY: normal viewers cannot see presence, including matches.
set local role service_role;
update public.profiles
set activity_status_visibility = 'nobody', last_seen_at = now()
where id = :target;

set local role authenticated;
select set_config('request.jwt.claim.sub', :viewer_match, true);
select *
from public.get_profile_presence_for_viewer(:target, null);

-- EVENT CONNECTIONS: same relevant event can see presence only with explicit event context.
set local role service_role;
update public.profiles
set activity_status_visibility = 'event_connections', last_seen_at = now()
where id = :target;

set local role authenticated;
select set_config('request.jwt.claim.sub', :viewer_non_match, true);
select *
from public.get_profile_presence_for_viewer(:target, null);
select *
from public.get_profile_presence_for_viewer(:target, :shared_event);

-- RAW GRANTS: normal clients should not be able to read these columns directly.
-- Run these one at a time; each should fail with permission denied for the column.
-- select last_seen_at from public.profiles where id = :target;
-- select show_online_status from public.profiles where id = :target;
-- select activity_status_visibility from public.profiles where id = :target;

-- HELPER SPOOF GUARD: normal clients should not be able to call the helper
-- directly, and service-role/admin diagnostics should not use it as a raw
-- presence backdoor.
-- select public.can_view_profile_presence(:viewer_match, :target, null);

-- ADMIN GHOST RPC: non-admin should fail with insufficient_privilege.
-- Run this one separately; the expected permission error aborts the current transaction.
select set_config('request.jwt.claim.sub', :viewer_non_match, true);
-- select * from public.detect_ghost_bootstrap_accounts(7, 0);

rollback;
