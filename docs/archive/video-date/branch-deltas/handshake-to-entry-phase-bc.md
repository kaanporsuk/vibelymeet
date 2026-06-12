# handshake → entry, Phase B/C (additive DB compat + client reader migration)

Date: 2026-06-10
Branch: `codex/handshake-to-entry-phase-a-cleanup` (continuation)
Audit: `docs/branch-deltas/handshake-to-entry-audit.md`

## Phase B — additive DB compat (deployed)

Forward migration `supabase/migrations/20260610130000_video_date_handshake_to_entry_compat.sql`. **Behavior-preserving and additive** — nothing renamed or dropped:

- **Mirror columns** `video_sessions.entry_started_at` / `entry_grace_expires_at` as `GENERATED ALWAYS AS (handshake_started_at|handshake_grace_expires_at) STORED`. Read-only, always equal to the canonical handshake columns, no dual-write logic, cannot desync.
- **Entry-named RPC wrappers** delegating to the existing handshake functions, with the same signatures and grants:
  - `video_session_entry_auto_promote_v2` → `video_session_handshake_auto_promote_v2` (authenticated, service_role)
  - `video_session_continue_entry_v2` → `video_session_continue_handshake_v2` (authenticated, service_role)
  - `finalize_video_date_entry_deadline` → `finalize_video_date_handshake_deadline` (service_role)
  - `expire_due_joined_video_date_entries_bounded` → `expire_due_joined_video_date_handshakes_bounded` (service_role)
- **`video_date_transition` action aliases**: `complete_entry` / `continue_entry` map to `complete_handshake` / `continue_handshake` before delegating to the base; the `enter_handshake` removed-guard and the full failsoft body are unchanged; old actions pass through untouched.

Generated types regenerated (`npm run regen:supabase-types`): the new columns + functions now appear in `src/integrations/supabase/types.ts`.

**Cloud:** applied to project `schdyxcunwcvddlcshwd` via `supabase db push`. Migration runs in a transaction (atomic; a malformed migration would have rolled back cleanly). Post-push dry-run: "Remote database is up to date".

## Phase C — client reader migration (done)

Migrated the client RPC call sites to the new entry wrappers (behavior-identical via the Phase B delegation), exercising the compat layer over the real client→backend path:

- `src/pages/VideoDate.tsx`: `video_session_continue_handshake_v2` → `video_session_continue_entry_v2`; `video_session_handshake_auto_promote_v2` → `video_session_entry_auto_promote_v2`.
- `apps/mobile/lib/videoDateApi.ts`: same two.
- Updated the client-code contract assertions in `videoDatePhase3Contracts`, `videoDatePhase3RemainingContracts`, `videoDatePhase5TimelineContracts` to the new wrapper names. The feature-flag (`video_date.outbox_v2.continue_handshake`) and transition-action-string (`'continue_handshake'`) assertions are unchanged — those surfaces are intentionally kept on handshake.

## Phase C — Edge Function migration: DEFERRED (rationale)

The plan called for migrating the 5 Edge Functions (`daily-room`, `send-notification`, `video-date-token-refresh`, `video-date-snapshot`, `admin-video-date-ops`) to the entry vocabulary + cloud deploys. On inspection this is **deferred deliberately**:

- The Edge change would be **behavior-neutral**: `entry_started_at` is an exact generated mirror (=== `handshake_started_at`), and the `phase`/`state` value comparisons `=== 'handshake'` **cannot change until the enum rename (Phase D)**. So only internal column reads would change, with identical values.
- The output payloads carry `handshake_started_at` **keys** that downstream clients/functions consume; renaming those keys would break consumers and is out of scope for a behavior-neutral pass.
- It would require deploying `daily-room` (the heart of date entry) and the other critical functions to **production with no two-user end-to-end verification available** in this environment — real risk for **zero** behavior benefit.
- The `handshake_started_at` column is not dropped for several phases, so there is **no functional need** to migrate the Edge reads now.

Recommendation: do the Edge migration in lockstep with the phase that actually drops the handshake column (and/or the enum rename), behind a real two-user verification window.

## Verification

- `npm run typecheck` ✅ · `npm run lint` ✅
- `npm run test:video-date-v4` ✅ · `npm run test:video-date:red-flags` ✅ · `videoDateEntryPersistence.test.ts` 18/18 ✅
- `supabase db push --linked --dry-run` → "Remote database is up to date"; `migration list` shows `20260610130000`.

## Proof boundary

Additive compat + client reader migration; behavior is unchanged (mirror columns and delegating wrappers). Not Video Date acceptance — no two-user run was possible here. The acceptance bar remains a real run: Ready Gate → date entry, pass/vibe decision period, auto-promote/finalize, post-date survey persists `date_feedback`.

## Remaining (Phase D/E — separate sign-off + real e2e window)

`ALTER TYPE video_date_state RENAME VALUE 'handshake' → 'entry'`, phase-string flip, Edge migration, feature-flag-key rename, and retiring the handshake columns/functions/actions once the entry surfaces are proven.
