# Vibely Rebuild Rehearsal Log

Date: 2026-03-11
Baseline: current controlled baseline
Branch: ops/rebuild-rehearsal-log
Commit: ff2025a1aed1ef8c77aed20614a58ee49ccd3a80

## 1. Rehearsal status
success

## 2. Baseline under test
- git commit: ff2025a1aed1ef8c77aed20614a58ee49ccd3a80
- node version: v25.6.0
- npm version: 11.8.0
- supabase cli version: 2.75.0
- linked project ref: schdyxcunwcvddlcshwd

## 3. Exact commands run
1. git switch -c ops/rebuild-rehearsal-log
2. git rev-parse HEAD
3. node -v
4. npm -v
5. supabase --version
6. git status --short
7. npm ci
8. ls .env*
9. supabase projects list --output json
10. supabase secrets list --project-ref schdyxcunwcvddlcshwd --output json
11. ./scripts/check_migration_parity.sh
12. supabase db push --linked --dry-run
13. supabase functions deploy delete-account email-verification event-notifications push-webhook geocode vibe-notification verify-admin forward-geocode daily-room phone-verify email-drip unsubscribe admin-review-verification create-video-upload video-webhook delete-vibe-video upload-image upload-voice upload-event-cover create-checkout-session stripe-webhook create-event-checkout create-credits-checkout create-portal-session cancel-deletion request-account-deletion send-notification generate-daily-drops upload-chat-video --use-api --project-ref schdyxcunwcvddlcshwd
14. npm run build
15. browser-based authenticated smoke on https://vibelymeet.com

## 4. Results by stage

### Dependency install
- npm ci: PASS

### Frontend env restore
- Existing env files present:
  - .env
  - .env.backup.local
  - .env.cursor.local
  - .env.functions.production

### Supabase link
- Linked project healthy:
  - schdyxcunwcvddlcshwd
  - MVP_Vibe
  - eu-west-1
  - ACTIVE_HEALTHY

### Secrets presence check
- Expected secret names present for:
  - Supabase
  - Bunny
  - OneSignal
  - Stripe
  - Twilio
  - Resend
  - hardening-specific secrets

### Migration validation
- check_migration_parity.sh: PASS
- Local migration files: 104
- Remote applied versions: 104
- Missing local/remote versions: 0
- supabase db push --linked --dry-run: Remote database is up to date

### Edge Function deployment
- 29 functions deployed successfully
- JWT posture remained aligned with hardened baseline

### Frontend build
- npm run build: PASS

### Smoke validation
- authenticated shell loads
- onboarding loads
- canonical authenticated routes resolve
- onboarding gating behaves as expected
- no new structural blocker found

## 5. Ambiguities found
- Rehearsal used an already-prepared controlled environment rather than reconstructing env from zero
- OneSignal legacy worker naming may still produce non-blocking console noise depending on provider SDK behavior

## 6. Missing or stale documentation
- None found that blocked the rehearsal
- Future route-smoke docs should continue using canonical routes, not legacy /app/... assumptions

## 7. Missing config / provider dependencies
- None newly discovered that blocked rebuild
- Known provider-side dependencies remain documented in provider sheets and runbook

## 8. Rebuild delta / fallout from the rehearsal

### Routes
- No route changes in this rehearsal

### Edge Functions
- Full function deploy verification completed successfully

### Schema / Storage
- No schema changes
- Migration parity remained clean

### Environment / Secrets
- Existing env/secrets set was sufficient

### Provider / External Setup
- Production-linked Supabase access and current provider wiring were sufficient for the rehearsal

### Rebuild Pack Docs Updated
- This log file is the durable evidence artifact for the rehearsal

### Notes / Risks
- Rehearsal validated the current controlled baseline, not the historical frozen archive
- Future major streams must continue updating rebuild-pack artifacts in-branch

## 9. Final judgment
- Rebuild rehearsal complete and logged: yes
- Current baseline suitable for continued pre-native remediation work: yes
- Exact blocker remaining before native work: remediation streams themselves, not rebuildability
