# Supabase `types.ts` regeneration summary — 2026-04-14

**Source of truth:** Linked project `schdyxcunwcvddlcshwd` (`supabase gen types typescript --project-id … --schema public`).

**Command (canonical):** `./scripts/regen-supabase-types.sh` (or `npm run regen:supabase-types`).

## Diff character (committed → generated)

Approximate change size: **~276 insertions / ~217 deletions** in the single file (line churn, not necessarily distinct concepts).

### Notable structural deltas

1. **`graphql_public` schema block removed** from `Database` — the generated `public`-only output does not include the GraphQL helper schema. No app code referenced `Database["graphql_public"]` (grep-clean).

2. **New table: `notification_outbox`** — full Row/Insert/Update/Relationships for the durable notification pipeline (matches live DB).

3. **`waitlist_promotion_notify_queue`** — adds `outbox_enqueued_at` nullable column on Row/Insert/Update.

4. **Read-model views (`v_event_loop_*`)** — `Insert`/`Update` shapes for views moved from `never` to nullable field types in generated output (PostgREST view typing); aligns with current Supabase typegen behavior.

5. **Constants / enums** — `Constants.public.Enums` and `Database["public"]["Enums"]` remain consistent with four enum groups (`app_role`, `notification_platform`, `notification_status`, `video_date_state`).

## Verification

- `npm run typecheck` — **PASS** after replacing `src/integrations/supabase/types.ts` with regenerated output + file header.
