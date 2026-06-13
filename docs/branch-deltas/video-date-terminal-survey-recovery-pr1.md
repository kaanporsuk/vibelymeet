# Video Date Terminal Survey Recovery PR 1

Date: 2026-06-14

## Scope

Hardened web `/date/:sessionId` terminal survey recovery for sessions that have already reached a real date and then terminalized into post-date survey state.

## Changes

- Treat `provider_absence_after_confirmed_encounter` plus `date_started_at` as survey-due terminal truth when the actor's own `date_feedback` row is missing.
- Kept the generic terminal survey gate strict: ordinary terminal rows still need confirmed encounter exposure and `pre_stable_media_failed` remains survey-ineligible.
- Made web terminal recovery treat an already-mounted `PostDateSurvey` as handled so later route/leave suppression cannot bounce away from it.
- Extended web `in_survey` registration fallback to check the actor's own `date_feedback` row before opening the survey, and to release/navigate only after that row exists.
- Added a date-route load guard for `canAttemptDaily` sessions whose registration already says `in_survey`, so the route recovers survey state before retrying Daily entry.

## Verification Notes

Static coverage was added in the shared route/controller contracts and the web hardening contract. Product acceptance still requires a fresh two-user run through both users' persisted `date_feedback` rows.
