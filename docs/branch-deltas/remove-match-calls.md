# Remove Match Calls

Date: 2026-06-09
Branch: `codex/remove-match-calls`

## Scope

Remove the non-golden Chat Match Calls product surface. This deletes ad hoc voice/video calls between matches while preserving Chat text/image/video/voice messages, `matches`, date suggestions, and the golden Video Date path through `prepare_date_entry`.

Removed active surfaces:

- Web and native Match Call hooks, API clients, overlays, providers, and chat call buttons.
- Match-call-specific permission UX capabilities, notification preference toggles, push category handling, and native deep-link suppression.
- `daily-room` actions `create_match_call`, `answer_match_call`, and `join_match_call`.
- Match-call handling from `daily-room delete_room`.
- `match-call-room-cleanup` Edge Function source/config.
- Shared Match Call diagnostics and edge-code helpers.

## Database

Migration: `supabase/migrations/20260609224646_remove_match_calls.sql`

The migration:

- Drops `public.match_calls`.
- Drops `public.match_call_transition(uuid, text, text)` and `public.match_call_transition(uuid, text)`.
- Drops `public.expire_stale_match_calls()`.
- Unschedules match-call cleanup/stale-call cron jobs if present.
- Removes `public.match_calls` from `supabase_realtime` publication if present.
- Drops `notification_preferences.notify_match_calls`.
- Rewrites active cleanup/admin RPCs that previously referenced `match_calls`: `unmatch_match`, `block_user_with_cleanup`, `admin_get_provider_health`, and `admin_create_data_export_job`.

Linked Supabase verification after apply:

- `supabase db push --linked --dry-run` returned `Remote database is up to date`.
- `supabase migration list --linked` includes local/remote `20260609224646`.
- Direct catalog checks returned `true` for absence of `match_calls`, both `match_call_transition` overloads, `expire_stale_match_calls`, `notify_match_calls`, realtime publication membership, and match-call cron jobs.
- `npm run regen:supabase-types` regenerated `src/integrations/supabase/types.ts` with no Match Call table/RPC/preference entries.
- `supabase functions delete match-call-room-cleanup --project-ref schdyxcunwcvddlcshwd` deleted the stale deployed cleanup function; a follow-up function list showed `daily-room` and `send-notification` active and no `match-call-room-cleanup` row.

## Preserved

- Chat message sending and normal media messages remain active on web and native.
- Match archive/mute/unmatch/block flows remain server-owned.
- `matches`, `match_id`, date suggestions, and date coordination rows remain.
- Golden Video Date remains `Event Lobby -> mutual match -> Ready Gate -> both_ready -> prepare_date_entry -> /date/:sessionId -> Daily video date -> post-date survey`.
- `daily-room` still supports `prepare_date_entry`, `video_date_leave`, and Video Date `delete_room` skip semantics.

## Validation

- Removal coverage updated in `shared/matching/dailyRoomLegacyActionRemovalContracts.test.ts`, `shared/matching/dailyProviderOperationalQa.test.ts`, `shared/chat/chatOverflowActionsContracts.test.ts`, permission surface contracts, profile privacy contracts, and `supabase/functions/daily-room/dailyRoomContracts.test.ts`.
- Edge Functions `daily-room` and `send-notification` were deployed to linked Supabase project `schdyxcunwcvddlcshwd`.
- The obsolete deployed Edge Function `match-call-room-cleanup` was deleted from linked Supabase project `schdyxcunwcvddlcshwd`.

## Proof Boundary

This removes Match Calls and simplifies the Daily/Chat backend surface. It does not certify Video Date product success. Video Date remains unaccepted until a fresh disposable two-user production run reaches both persisted `date_feedback` rows after a completed date.
