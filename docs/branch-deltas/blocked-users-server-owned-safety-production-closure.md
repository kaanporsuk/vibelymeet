# Blocked Users server-owned safety - production closure

Date: 2026-04-26
Status: Production-closed for safety enforcement

## Deployed state

- Main includes:
  - `c80472e85` - `Fix blocked-users migration version collision`
  - `1e6f7d21b` - `Fix blocked-user safety enforcement`
- Supabase project: `schdyxcunwcvddlcshwd`
- Applied migrations:
  - `20260430211000_blocked_users_server_owned_safety`
  - `20260430211500_blocked_users_post_date_verdict_hardening`
- Deployed Edge Functions:
  - `send-message`
  - `send-game-event`
  - `send-notification`
  - `daily-room`
  - `daily-drop-actions`
  - `swipe-actions`
- Web production deployment for `c80472e85` completed successfully.

## Production smoke result

Isolated disposable production smoke users were created for the verification run and deleted during cleanup. The existing unsafe smoke pair with 1 match and 71 messages was not mutated.

Smoke passed:

- direct block of an existing match
- report + block
- stale post-date verdict after block
- Daily Drop transition after block
- Daily room/token denial
- notification suppression
- unblock semantics

Final cleanup removed the test-created users and rows. No real users were mutated.

## Remaining follow-up

Daily-room blocked responses should be normalized to stable blocked codes for clearer client UX and observability.

- Follow-up issue: https://github.com/kaanporsuk/vibelymeet/issues/514
- Preferred response codes: `BLOCKED_PAIR`, `USERS_BLOCKED`, or `blocked_pair`
- Observed production behavior:
  - `create_date_room` returned `SESSION_NOT_FOUND` through RLS-shaped denial
  - `create_match_call` returned `ACCESS_DENIED`

Safety is correct because no Daily room or token escaped across the block. This is P2 polish, not an open safety hole.
