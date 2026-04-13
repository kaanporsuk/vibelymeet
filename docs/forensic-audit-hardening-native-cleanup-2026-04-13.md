# Forensic audit — hardening/native cleanup

**Date:** 2026-04-13  
**Branch:** `audit/full-forensic-hardening-native-cleanup`  
**Scope:** PRs `#378` through `#389`, plus related docs, manifests, runbooks, and inventory updates.

## Verdict

Merge-ready.

The landed hardening/native sequence is structurally sound. I did **not** find a client/server contract break, migration-history inconsistency, or security posture regression in the audited range. The only proven-safe cleanup in this pass was documentation drift in active source-of-truth docs.

## What is solid

- Ready-gate polish landed as intended: shared copy, session validation, and stale-link handling are aligned across web and native.
- Queue hygiene landed as intended: ended sessions are excluded from queue counts and the missing repo/cloud migration file is now represented locally.
- Event-loop observability, read-model views, retention prune, and follow-up revoke all landed and are internally consistent.
- Native date end-path parity landed: joined-call exits converge on `PostDateSurvey`; pre-connect abort intentionally skips survey.
- Native deep-link gating and chat read-receipt parity landed and match the current route/auth gate contract.
- Native in-call vibe/extend extras landed and match intended backend-owned semantics.

## What was messy but acceptable

- `pendingNotificationDeepLink.ts` is in-memory only. That is acceptable for the shipped “defer until entry-ready in this app launch” behavior.
- Historical sprint docs still contain then-current gap language. That is acceptable as provenance if active docs stay current.
- Pre-connect date abort still skips survey. That is an intentional product distinction, not a regression.

## What was actually wrong

1. `apps/mobile/README.md` still described deep links, read receipts, and post-date survey parity as deferred even though those landed in `#386–#389`.
2. `docs/native-sprint0-architecture-lock.md` was already the canonical doc in `docs/active-doc-map.md`, but still carried stale future-tense “next branch / next implementation order” sections for work that had already landed.

## Files changed in this pass

- `apps/mobile/README.md`
- `docs/native-sprint0-architecture-lock.md`
- `docs/forensic-audit-hardening-native-cleanup-2026-04-13.md`

## Deliberately not removed

- `docs/native-v1-sprint0-architecture-lock-plan.md`
- `docs/mobile-sprint5.md`
- `_cursor_context/*` historical provenance files
- compatibility aliases in `shared/matching/videoSessionFlow.ts`
- dual lobby params `pendingVideoSession` and `pendingMatch`

These were kept because proof was insufficient to call them obsolete and safe to delete.

## Validation

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm run lint` — passed with existing repo-wide warnings only (`219 warnings, 0 errors`)
- `supabase migration list` — local and remote aligned through `20260425130000`

## Remaining real gaps

- Real-device proof still sits outside repo-only audit scope for OneSignal delivery/taps, Daily runtime, and RevenueCat purchase/restore.
- Pre-connect video-date abort intentionally bypasses `PostDateSurvey`.
