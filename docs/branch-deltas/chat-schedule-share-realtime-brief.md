# Chat Schedule Share — Realtime propagation brief (separate workstream)

Status: **Not implemented in the schedule-share Accept/Edit branch.**
Branch scope: backend authority + grant-owner Edit + start-time-only Accept.
This document defines the realtime follow-up so it can be picked up as a
dedicated workstream without re-litigating product behavior.

## Why realtime is needed

The schedule-share Accept/Edit branch added two coupled product surfaces:

1. Schedule-share **Accept** locks a Vibely Schedule block on both sides via
   `_apply_date_plan_event_lock` (writes to `user_schedules`).
2. Schedule-share **Edit selected blocks** rewrites the caller's row in
   `schedule_share_grants` and its `schedule_share_grant_slots` set (atomic
   replace via `_date_suggestion_upsert_share_grant`).

Today, only the **acting tab** sees those changes. Other tabs of the same user
and the partner's tabs only refresh on next refetch / focus. The realtime
workstream's job is to invalidate the right React Query caches when the
underlying tables change so the UI stays consistent across tabs, devices, and
partner actions.

## Hard constraints (carry over from product/security review)

- Realtime events are **cache-invalidation signals only**.
- **Never** render raw realtime payloads as private schedule data.
- Authorized refetch / RPC remains the source of truth (RLS-filtered).
- **No** UI redesign.
- **No** Accept/Edit behavior changes.
- **No** native changes in this workstream.
- **No** OneSignal changes.

## Tables to subscribe to (server side)

These tables are already in `supabase_realtime` publication (verified in
`20260326120000_date_suggestion_foundation.sql` and
`20260511130000_chat_schedule_selective_share_and_event_lock.sql`):

- `public.date_suggestions`
- `public.date_suggestion_revisions`
- `public.date_plans`
- `public.user_schedules`
- `public.schedule_share_grants`
- `public.schedule_share_grant_slots`

The realtime branch must **not** add new publication tables without an explicit
RLS audit — these payloads carry private scheduling intent.

## React Query keys to invalidate on each event

| Event source | Trigger | Invalidation set |
|--------------|---------|------------------|
| `date_suggestions` UPDATE | status / current_revision_id / schedule_share_expires_at change for a row where caller is proposer or recipient | `["date-suggestions", matchId]`, thread messages key for the chat |
| `date_suggestion_revisions` INSERT | new revision on a suggestion the caller participates in | `["date-suggestions", matchId]` |
| `date_plans` INSERT / UPDATE | new/updated plan that references one of caller's suggestions | `["date-suggestions", matchId]`, `["schedule-hub", currentUserId]` |
| `user_schedules` INSERT / UPDATE | row where user_id = currentUserId | `["user-schedule"]` |
| `user_schedules` INSERT / UPDATE | row where user_id = partner of an open suggestion | `["shared-schedule", matchId, partnerUserId]` |
| `schedule_share_grants` INSERT / UPDATE / DELETE | row where viewer_user_id = currentUserId **or** subject_user_id = currentUserId | `["shared-schedule", matchId, subjectUserId]`, **`["caller-schedule-share-grant", matchId, suggestionId, currentUserId]`** |
| `schedule_share_grant_slots` INSERT / DELETE | slot rows attached to a grant where caller is viewer or subject | `["shared-schedule", matchId, subjectUserId]`, **`["caller-schedule-share-grant", matchId, suggestionId, currentUserId]`** |

### New query key added by this branch (REQUIRED)

```
["caller-schedule-share-grant", matchId, suggestionId, currentUserId]
```

Owner: `src/hooks/useCallerScheduleShareGrant.ts`

This is the cache that backs the **Edit selected blocks** affordance on a
schedule-share date card. It reads the caller's own `schedule_share_grants`
row scoped to a specific active suggestion. Without realtime invalidation,
the UI can show **stale Edit visibility** across tabs and after:

- the grant expires (`expires_at <= now()`)
- a partner edits/replaces their own grant (does not affect this key, but
  the shared-schedule cache also needs to stay consistent)
- the caller's grant is rotated by `edit_schedule_share_slots`
- the caller's grant is removed entirely (e.g. suggestion cancelled or
  terminalized)

When `schedule_share_grants` or `schedule_share_grant_slots` change for the
current user / suggestion, **the realtime fix MUST invalidate**:

```ts
queryClient.invalidateQueries({
  queryKey: ["caller-schedule-share-grant", matchId, suggestionId, currentUserId],
});
```

This keeps the Edit affordance accurate across tabs, expiry, grant
replacement, and partner actions, and mirrors the server-side
`edit_schedule_share_slots` grant-owner gate.

## Scope guardrails

- No UI redesign.
- No Accept/Edit behavior changes.
- No new native code.
- No OneSignal changes.
- No new realtime publication tables without RLS audit.
- No client subscription to private columns (subscribe to row events; refetch
  through RLS-filtered RPC / table reads as authority).
- Cross-tab focus / window-visible refetch should be additive, not a
  replacement for explicit realtime invalidation.

## Out of scope for the realtime workstream

- Changes to `date_suggestion_apply_v2` or its action set.
- Changes to `_apply_date_plan_event_lock` / `_revert_date_plan_event_lock`.
- Changes to `get_shared_schedule_for_date_planning` signature or RLS.
- Changes to chat collapsed Date/Games bar, expanded + tray, Schedule label,
  Date modal, Accept button label, Counter/Not now/Decline/Cancel behavior,
  Type/Place rendering, "Both open" wording, My Vibe Schedule grid, My Dates
  tabs.

## Manual QA the realtime owner will need (separate, not in scope here)

- Open chat in two tabs; Accept on one → Edit affordance disappears in the
  other tab without manual refresh.
- Sender edits selected blocks in one tab → shared-schedule chips on the
  partner's card in another session update without manual refresh.
- Grant expires while the card is mounted → Edit affordance disappears
  without manual refresh.
