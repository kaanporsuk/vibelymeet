# VIBELY — CURSOR HARDENING CAMPAIGN

**Date:** 2026-03-11  
**Baseline:** post-hardening (frozen golden: pre-native-hardening)  
**Canonical source pack:**
- `VIBELY_GOLDEN_SNAPSHOT_AUDITED.md`
- `VIBELY_REBUILD_RUNBOOK.md`
- `VIBELY_DISCREPANCY_REPORT.md`
- `VIBELY_SCHEMA_APPENDIX.md`
- `VIBELY_EDGE_FUNCTION_MANIFEST.md`
- `VIBELY_MIGRATION_MANIFEST.md`
- `VIBELY_MACHINE_READABLE_INVENTORY.json`

---

## 1. Objective

Turn the recovered rebuild pack into an active control system for engineering work.

The goal of this campaign is **not** only to improve code quality. It is to ensure that every major branch, refactor, cleanup pass, or native-prep change preserves rebuildability against the frozen web baseline.

In plain terms:
- no hidden infrastructure drift
- no undocumented architecture drift
- no silent deletion of critical surfaces
- no new secrets/config dependencies introduced without capture
- no future rebuild depending on memory

---

## 2. Why this campaign exists

The audited rebuild pack proved that the repo and the previous prose snapshot were not perfectly aligned.

The most important examples were:
- omitted backend surfaces like `forward-geocode` and `push-webhook`
- unrouted but real surfaces like `VideoLobby.tsx`
- incomplete env understanding when relying on the checked-in `.env`
- hardcoded production dependencies outside clean env-only configuration
- migration history that includes risky non-schema behavior

That means Vibely is already at the stage where “clean up as we go” is not safe enough.

A hardening campaign is required to make future work mechanically recoverable.

---

## 3. Campaign outcome definition

This campaign is successful when all of the following are true:

1. a future operator can rebuild the frozen web baseline without relying on undocumented tribal knowledge  
2. major code changes cannot land without exposing new rebuild-impacting drift  
3. Cursor is working from explicit preservation rules rather than informal judgment  
4. architecture changes generate structured documentation deltas as part of the change itself  
5. native-build preparation can proceed without destroying web rebuildability

---

## 4. Hardening principles

### Principle 1 — Preserve before improving
Do not delete, rename, consolidate, or “simplify” rebuild-relevant surfaces until they are inventoried and replacement-mapped.

### Principle 2 — The repo is not the whole system
Supabase secrets, provider dashboards, webhook registrations, DNS, and hardcoded runtime assumptions all count as architecture.

### Principle 3 — Every architectural change must emit a documentation delta
If the system changes, the pack changes in the same branch.

### Principle 4 — Hidden config is a defect
A new env var, dashboard dependency, webhook secret, or provider-side toggle that is not recorded is considered a regression.

### Principle 5 — Rebuildability outranks local convenience
Fast cleanup that makes the system less reconstructable is not an acceptable optimization.

---

## 5. Scope of the campaign

This campaign applies to any work that touches one or more of the following:

- routes/pages
- auth flow
- admin surfaces
- profile/media flows
- Supabase schema or RLS
- storage buckets or media paths
- Edge Functions
- payments or premium logic
- notifications or push delivery
- provider integrations
- environment variables
- deployment/runtime assumptions
- native-build prep that changes shared business logic or backend surfaces

---

## 6. Canonical baseline to preserve

The frozen pre-native-hardening baseline is the comparison point.

The following surfaces are considered canonical for drift detection:

### Frontend surface
- route map
- page inventory
- major wrapper/providers
- service layer entry points
- hardcoded runtime config points

### Backend surface
- public tables
- views
- SQL functions / RPCs
- storage buckets
- Edge Functions
- JWT posture and config coverage
- migration history

### Runtime/config surface
- frontend env names
- backend env names
- hardcoded domains
- webhook endpoints
- provider relationships

### Operational surface
- rebuild sequence
- provider-side manual setup requirements
- known replay risks
- documented exceptions and legacy surfaces

---

## 7. Non-negotiable preservation rules

These rules should govern Cursor-assisted work.

### Rule A — No silent surface removal
If a file, route, function, table, bucket, or env var disappears, the change must explicitly say:
- what was removed
- why it is safe
- what replaces it, if anything
- what docs/manifests were updated because of that removal

### Rule B — No new config without capture
If a change introduces a new env var, secret, dashboard dependency, provider credential, webhook secret, or domain dependency, it must be added to the inventory in the same branch.

### Rule C — No schema change without manifest update
Any migration that changes tables, views, enums, functions, storage, or policies must also update:
- schema appendix
- migration manifest summary if the change is material
- machine-readable inventory JSON if object lists change

### Rule C.1 — No remote migration operations without parity check
Before any operator (or Cursor) runs remote migration operations (push/pull/repair), run:

```bash
./scripts/check_migration_parity.sh
```

If it reports parity drift, stop. Do not run `supabase db push`, `supabase db pull`, or `supabase migration repair` until drift is understood and handled as a dedicated workstream.

As of 2026-03-11, one such dedicated workstream has been completed for the linked production project:
- drift caused primarily by timestamp aliasing was repaired via **metadata-only** history updates
- two remote-only artifacts are now represented locally by **no-op placeholder migrations**
- the chat-videos anon-read policy migration (`20260311000000_chat_videos_anon_read.sql`) is recorded as applied in history
- migration parity is currently clean and `supabase db push --linked --dry-run` reports the remote database as up to date

### Rule D — No Edge Function change without function-manifest review
Any added, removed, renamed, or materially changed function must update:
- Edge Function manifest
- machine-readable inventory JSON
- rebuild runbook if deployment/secrets/auth posture changed

### Rule E — No route/page drift without route inventory update
Any page addition/removal/redirect/reroute must update:
- audited golden snapshot
- machine-readable inventory JSON

### Rule F — No “cleanup” that erases legacy context without replacement notes
Unrouted or legacy surfaces may be removed only after they are documented and the reason for removal is recorded.

### Rule G — No provider change without external-setup notes
If Stripe, Bunny, Daily, Twilio, Resend, OneSignal, PostHog, Sentry, or domain setup changes, the runbook must reflect the new manual setup reality.

---

## 8. Required inventory dimensions going forward

For every major branch, Cursor should actively watch these categories.

### 1. Repo surface drift
- new or removed pages
- new or removed hooks/services
- new or removed function directories
- new or removed migrations
- new or removed config files

### 2. Runtime config drift
- new Vite vars
- new Edge Function env vars
- new hardcoded domains/URLs/app IDs
- changed webhook endpoints

### 3. Backend object drift
- table additions/removals
- view additions/removals
- RPC additions/removals
- enum changes
- storage bucket changes
- RLS/policy intent shifts

### 4. Integration drift
- new third-party service
- changed provider usage path
- changed auth flow with provider
- changed dashboard-only dependency

### 5. Build/rebuild drift
- new install or CLI steps
- changed deployment sequence
- new secrets injection path
- new local-vs-production mismatch

---

## 9. Cursor operating brief

This is the core operating brief that should guide Cursor on all major Vibely changes.

### Cursor system brief

You are working on Vibely against a frozen pre-native-hardening baseline that must remain rebuildable.

Before making changes:
- identify all impacted routes, functions, schema objects, env vars, storage buckets, hardcoded config points, and provider integrations
- compare the proposed changes against the existing rebuild pack
- treat missing documentation updates as defects, not optional cleanup

When making changes:
- do not silently remove rebuild-relevant surfaces
- do not introduce new env vars or secrets without recording them
- do not assume the checked-in `.env` is authoritative
- do not assume `verify_jwt = false` means anonymous-safe behavior
- do not assume a migration is safe just because it applies on your current environment
- preserve or explicitly replace hardcoded production assumptions if they still matter

After making changes:
- emit a rebuild delta
- list any added/removed routes, functions, tables, buckets, env vars, migrations, webhook endpoints, or provider dependencies
- state which rebuild-pack documents must be updated
- update those documents in the same branch whenever possible

---

## 10. Standard Cursor prompts for this campaign

### Prompt 1 — Pre-change impact audit
Before editing anything, compare the target files to the current Vibely rebuild pack and tell me:
- what rebuild-critical surfaces could be affected
- what hidden config or provider dependencies may be involved
- what docs/manifests must change if this work lands
- what legacy surfaces might be accidentally broken by cleanup

### Prompt 2 — Safe implementation mode
Implement the change, but preserve rebuildability.
Do not remove or rename routes, functions, schema objects, buckets, or env surfaces unless you explicitly document the removal and replacement mapping.
Call out any newly introduced configuration, secret, webhook, or provider dependency.

### Prompt 3 — Rebuild delta generation
Generate a rebuild delta for this branch.
List:
- routes added/removed/changed
- Edge Functions added/removed/changed
- schema/storage changes
- env vars added/removed/changed
- hardcoded runtime dependencies added/removed/changed
- provider/dashboard changes required outside the repo
- documents in the rebuild pack that now need updating

### Prompt 4 — Legacy cleanup guard
Before deleting any “unused” or “legacy” surface, prove whether it is:
- routed
- referenced dynamically
- build-relevant
- provider-coupled
- historically important for rebuild
If it is safe to remove, produce a removal note and replacement mapping first.

### Prompt 5 — Migration risk audit
Review this migration for replay risk.
Flag whether it contains:
- destructive deletes
- hardcoded user IDs
- test/QA fixture data
- provider/environment assumptions
- RLS/security behavior changes
Then classify it as schema-only, schema+policy, data backfill, or operational/test migration.

---

## 11. Mandatory branch checklist

Every significant branch should be reviewed against this checklist before merge.

### Architecture drift
- Were any routes added, removed, redirected, or repurposed?
- Were any Edge Functions added, removed, renamed, or materially changed?
- Were any tables, views, enums, SQL functions, or buckets added/removed/changed?

### Config drift
- Were any env vars added, renamed, or removed?
- Were any secrets/provider credentials newly required?
- Were any hardcoded runtime values added or changed?

### External dependency drift
- Did any provider-side setup change?
- Did any webhook endpoint or callback URL change?
- Did any domain/CDN assumption change?

### Documentation drift
- Was the rebuild pack updated where required?
- Was a rebuild delta generated?
- Are legacy removals explicitly documented?

### Risk drift
- Did any migration introduce destructive or environment-specific behavior?
- Did any function’s auth posture change?
- Did any policy change broaden access accidentally?

---

## 12. Merge gate

A branch should not be considered merge-ready if any of the following are true:

- new env vars exist but are undocumented
- a new Edge Function exists but is not in the manifest
- a schema/storage object changed but the inventory was not updated
- a route changed but the route map is stale
- a provider/dashboard dependency changed but the runbook was not updated
- a legacy surface was removed without a documented replacement mapping
- a migration with destructive/test behavior was introduced without risk classification

---

## 13. Rebuild delta format

For every major branch, the delta should be written in this format.

### Rebuild Delta — `<branch or feature name>`

#### Routes
- added:
- removed:
- changed:

#### Edge Functions
- added:
- removed:
- changed:
- auth posture changes:

#### Schema / Storage
- tables:
- views:
- enums:
- SQL functions:
- buckets:
- RLS / policies:

#### Environment / Secrets
- frontend vars added/removed:
- backend vars added/removed:
- hardcoded runtime values changed:

#### Provider / External Setup
- webhook changes:
- dashboard changes:
- DNS/domain/CDN changes:
- new provider dependencies:

#### Rebuild Pack Docs Updated
- audited snapshot:
- runbook:
- discrepancy report:
- schema appendix:
- function manifest:
- migration manifest:
- inventory JSON:

#### Notes / Risks
- replay risks:
- legacy cleanup notes:
- manual follow-up required:

---

## 14. Rehearsal rebuild protocol

The campaign should include periodic rebuild rehearsals.

### Rehearsal frequency
- after major architecture shifts
- before native-build milestone transitions
- before any attempt to deprecate legacy web surfaces

### Rehearsal method
1. clean machine or clean containerized environment  
2. restore repo from frozen or current controlled baseline  
3. install dependencies exactly as prescribed  
4. restore frontend env vars  
5. restore Supabase linkage and secrets  
6. validate migration behavior deliberately  
7. deploy all Edge Functions  
8. verify critical product flows  
9. log every ambiguity or hidden dependency found during rehearsal

### Rehearsal output
The operator must produce:
- success/failure status
- steps that were ambiguous
- secrets/config that were missing from docs
- provider-side dependencies that were not captured
- required updates to the rebuild pack

---

## 15. First hardening pass — completed (auth posture)

The following were completed and documented in the rebuild pack:

### Done — Function auth posture
- All 28 functions in `config.toml`; no config gaps.
- 21 functions: `verify_jwt = true` (JWT-at-gateway).
- 7 functions: `verify_jwt = false` (public-but-protected): stripe-webhook, push-webhook, video-webhook, email-drip, unsubscribe, request-account-deletion, generate-daily-drops.
- Hardened: push-webhook (PUSH_WEBHOOK_SECRET required), forward-geocode (JWT + admin + rate limit), unsubscribe (UNSUB_HMAC_SECRET only, rate limit), email-drip (UNSUB_HMAC_SECRET for unsubscribe URLs), generate-daily-drops (CRON_SECRET or admin JWT), video-webhook (BUNNY_VIDEO_WEBHOOK_TOKEN URL token), daily-room (verify_jwt true; frontend unload uses fetch keepalive + JWT).

### Done — Required secrets documented
- PUSH_WEBHOOK_SECRET, UNSUB_HMAC_SECRET, CRON_SECRET, BUNNY_VIDEO_WEBHOOK_TOKEN.

### Done — Live storage reality
- Only `chat-videos` and `proof-selfies` are live Supabase buckets; others legacy/Bunny-migrated.

### Remaining (later passes)
- **Config centralization:** OneSignal app ID, Sentry DSN, PostHog host, production-domain, Bunny upload endpoint (hardcoded).
- **Migration chain classification:** structural / security / data backfill / operational.
- **Rebuild rehearsal:** cold run from pack and capture missing assumptions.

---

## 16. Native-build interaction rule

Native-build preparation is allowed to change shared logic, backend surfaces, and flows only if it does one of the following:

- preserves existing web rebuildability, or
- clearly creates a new canonical baseline and documents the delta from the pre-native-hardening baseline

Native work must not create a situation where the web baseline becomes historically unrecoverable.

---

## 17. Exit criteria

This campaign can be considered complete when:

- the rebuild pack is current and trusted
- major branch changes consistently emit rebuild deltas
- no hidden config/provider dependencies remain uncaptured
- function auth posture is explicit and reviewed
- migration risks are classified
- at least one clean rehearsal rebuild has been completed and logged
- the team can begin native-specific hardening without losing web baseline recoverability
- Latest committed rehearsal log: `_cursor_context/rebuild_rehearsals/2026-03-11_current-controlled-baseline.md`
---

## 18. Bottom line

The rebuild pack recovered the historical truth of Vibely’s pre-native-hardening state.

This campaign is what turns that truth into engineering discipline.

Without this step, the pack is documentation.
With this step, it becomes a control system for safe evolution.

