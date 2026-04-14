# `video_sessions.phase` vs `video_sessions.state`

**Current (2026-04):** Migrations and RPCs keep **both** columns aligned on transitions. Clients defensively read `state` first and fall back to legacy `phase` where both exist (`VideoDate.tsx`, `apps/mobile/lib/videoDateApi.ts` realtime handlers).

**Follow-up deprecation (when safe):**

1. Grep for `.phase` on `video_sessions` rows in app code; migrate reads to `state` only.
2. Confirm no external consumers rely on `phase` text (analytics exports, admin SQL).
3. Add a migration: stop writing `phase` in `video_date_transition` / related RPCs, then `DROP COLUMN phase` after a release window.

**Do not** drop the column until writes are removed everywhere and backfills are unnecessary.
