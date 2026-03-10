# VIBELY — DISCREPANCY REPORT

**Date:** 2026-03-10  
**Compared artifacts:**
- Claude snapshot: `vibely-golden-snapshot_claude.md`
- Frozen source of truth: `vibelymeet-pre-native-hardening-golden-2026-03-10.zip`
- Audited replacement: `VIBELY_GOLDEN_SNAPSHOT_AUDITED.md`

---

## 1. Purpose

This document records the material differences between Claude’s earlier “golden snapshot” and the actual frozen Vibely repository.

The goal is **not** to dismiss the earlier snapshot. It was directionally strong and captured much of the architecture correctly. The goal is to identify where it was incomplete, stale, approximate, or misleading for rebuild purposes.

For any conflict, the **frozen repo** is the canonical source.

---

## 2. Executive verdict

Claude’s earlier snapshot is **useful but not canonical**.

It gets the following broadly right:
- core stack
- primary route map
- major product flows
- most of the Supabase function surface
- most of the database surface
- general payment / media / notification architecture

However, it has several rebuild-critical gaps:
- missing Edge Functions
- incorrect or stale environment-variable names
- undercounted storage surfaces
- understated hardcoded production dependencies
- at least one incorrect dependency claim
- omission of certain repo surfaces that matter during rebuild and cleanup

Because of those gaps, Claude’s snapshot should be treated as a **high-quality draft reference**, not as the final rebuild baseline.

---

## 3. Severity legend

- **Critical** — can directly break rebuild or deployment fidelity
- **High** — can create wrong operational assumptions or missing config
- **Medium** — can mislead maintainers, but less likely to block rebuild immediately
- **Low** — descriptive or inventory-quality issue

---

## 4. Discrepancy summary table

| Severity | Area | Claude snapshot said | Audited repo reality | Why it matters |
|---|---|---|---|---|
| **Critical** | Edge Function inventory | Claimed “complete inventory” | Two functions were omitted: `forward-geocode`, `push-webhook` | Missing functions create incomplete rebuild manifests and can break runtime flows |
| **Critical** | Environment variables | Listed several env names that do not match source usage | Actual env names differ in multiple places | Wrong secret names cause deployment failure or silent misconfiguration |
| **High** | Domain / hosting state | Framed domain as `vibelymeet.lovable.app` with custom domain TBD | Source hardcodes `vibelymeet.com` and `cdn.vibelymeet.com` across multiple runtime surfaces | Rebuilds or migrations can miss critical domain coupling |
| **High** | Storage bucket inventory | Listed only 3 storage buckets | Frozen repo references at least 6 buckets: `profile-photos`, `proof-selfies`, `vibe-videos`, `event-covers`, `voice-messages`, `chat-videos` | Missing storage surfaces break uploads, playback, or access policies |
| **High** | Function config completeness | Inventory implied full function config picture | `forward-geocode` and `push-webhook` exist as function directories but are absent from `supabase/config.toml` | JWT behavior and deployment assumptions can drift |
| **High** | Hardcoded config | Documentation focused mostly on env-driven config | Several critical values are hardcoded in source | Rebuild operator may overlook required source edits |
| **Medium** | Package dependency status | Claimed some runtime libs were not in `package.json` | `@daily-co/daily-js`, `@sentry/react`, `posthog-js`, and `hls.js` are in `package.json` | Misstates dependency provenance and can cause needless debugging |
| **Medium** | Dead code / legacy surfaces | Listed some dead or legacy surfaces | Omitted unrouted `src/pages/VideoLobby.tsx` | Can lead to accidental deletion without documentation |
| **Medium** | `.env` reliability | Presented env inventory as if cleanly reconstructable | Root `.env` is partial and includes malformed / non-standard entries | Operators may trust the wrong file during rebuild |
| **Low** | Inventory precision | Used approximate counts like “30+ pages/hooks” | Frozen repo has materially larger exact inventory | Mostly documentation quality, but matters for audit rigor |

---

## 5. Detailed discrepancies

### 5.1 Missing Edge Functions from the “complete inventory”

Claude’s snapshot presented the function inventory as complete, but the frozen repo contains two additional deployable functions:

- `forward-geocode`
- `push-webhook`

These are not cosmetic omissions. They are part of the actual backend surface and therefore belong in:
- function inventory
- deployment runbook
- JWT-behavior review
- environment manifest review

**Impact:** rebuilds based only on Claude’s file would ship an incomplete function set.

---

### 5.2 Environment-variable name mismatches

Claude’s snapshot included multiple env names that do not match what the frozen source actually references.

#### Supabase frontend variable mismatch
Claude snapshot used:
- `VITE_SUPABASE_ANON_KEY`

Frozen source references:
- `VITE_SUPABASE_PUBLISHABLE_KEY`

#### PostHog variable mismatch
Claude snapshot used:
- `VITE_POSTHOG_KEY`
- `VITE_POSTHOG_HOST`

Frozen source references:
- `VITE_POSTHOG_API_KEY`

And the host is hardcoded in source rather than supplied via Vite env.

#### Bunny backend variable mismatch
Claude snapshot used names such as:
- `BUNNY_API_KEY`
- `BUNNY_STORAGE_ZONE_NAME`

Frozen source references:
- `BUNNY_STREAM_API_KEY`
- `BUNNY_STORAGE_ZONE`
- `BUNNY_STORAGE_API_KEY`
- `BUNNY_STREAM_LIBRARY_ID`
- `BUNNY_STREAM_CDN_HOSTNAME`
- `BUNNY_CDN_HOSTNAME`

**Impact:** operators using the old snapshot could set the wrong secrets and still believe they are correctly configured.

---

### 5.3 Domain state was understated

Claude’s snapshot described hosting as Lovable with domain:
- `vibelymeet.lovable.app`
- custom domain TBD

The frozen source shows a stronger operational dependency on the production domain already being real and embedded:
- `vibelymeet.com`
- `cdn.vibelymeet.com`

These values appear across runtime surfaces such as:
- links
- redirect URLs
- email content
- unsubscribe flows
- media/CDN references

**Impact:** this is not a mere branding detail; it affects deploy correctness and migration planning.

---

### 5.4 Storage bucket inventory was incomplete

Claude’s snapshot documented only these buckets:
- `profile-photos`
- `vibe-videos`
- `proof-selfies`

The frozen repo references additional storage buckets / surfaces including:
- `event-covers`
- `voice-messages`
- `chat-videos`

**Impact:** bucket creation, policies, or media migrations could be incomplete if built only from Claude’s document.

---

### 5.5 Function-config completeness was overstated

The repo’s `supabase/config.toml` does not fully cover the function-directory set.

Specifically, these function directories exist in source but are absent from `config.toml`:
- `forward-geocode`
- `push-webhook`

That means a rebuild operator cannot assume the configuration file alone captures intended JWT behavior for every deployed function.

**Impact:** deployment could succeed with incorrect public/private behavior unless explicitly reviewed.

---

### 5.6 Hardcoded config was under-documented

Claude’s snapshot generally described integrations correctly, but it underemphasized the degree to which some runtime values are hardcoded in source.

The audited repo confirms rebuild-sensitive hardcoded points such as:
- OneSignal App ID in `src/lib/onesignal.ts`
- Sentry DSN in `src/main.tsx`
- PostHog host in `src/main.tsx`
- Daily fallback domain in the `daily-room` function
- Bunny TUS upload endpoint in the frontend upload flow

**Impact:** a rebuild based only on env restoration is insufficient.

---

### 5.7 `.env` cannot be treated as authoritative

Claude’s snapshot presented an environment inventory, but the frozen repo’s root `.env` is not a dependable canonical manifest.

Problems include:
- partial coverage
- mixed frontend and backend concerns
- malformed / non-standard assignment lines
- absence of several backend secrets that are only inferable from function source

**Impact:** operators who trust only the checked-in `.env` will miss required runtime configuration.

---

### 5.8 Dependency claim was incorrect

Claude’s snapshot stated that the following were “not in `package.json` but used at runtime”:
- `@daily-co/daily-js`
- `@sentry/react`
- `posthog-js`
- `hls.js`

The frozen repo’s `package.json` does include all four.

**Impact:** low rebuild risk, but it weakens confidence in the earlier dependency audit.

---

### 5.9 Omitted repo surface: `VideoLobby.tsx`

Claude’s dead-code / legacy section documented several non-canonical surfaces, which was useful.

However, it did not call out that:
- `src/pages/VideoLobby.tsx` exists in the repo
- it is not wired into `src/App.tsx`

This is exactly the kind of file that gets accidentally deleted during cleanup unless it is explicitly documented.

**Impact:** moderate maintenance and cleanup risk.

---

### 5.10 Inventory precision was approximate rather than exact

Claude’s file used approximate descriptors like:
- “30+ pages”
- “30+ hooks”

The frozen repo is materially larger in exact counts.

The audited baseline recorded exact counts for key surfaces instead.

**Impact:** low direct rebuild risk, but exact counts are better for preservation and diffing.

---

## 6. What Claude’s snapshot still got right

The earlier snapshot remains valuable because it correctly captured much of the product and architecture shape.

Strong areas include:
- main route structure in `src/App.tsx`
- core product flow descriptions
- many of the major Edge Functions
- the existence and role of admin surfaces
- major database tables and RPCs
- major third-party providers
- the distinction between live video, messaging, events, premium, and daily drops

So the right operational stance is:
- **do not discard it as useless**
- **do not rely on it as final truth**

---

## 7. Canonical replacement guidance

Going forward, the documentation precedence should be:

1. frozen repo ZIP  
2. audited golden snapshot  
3. rebuild runbook  
4. manifests and appendices  
5. Claude snapshot only as historical reference

If an operator sees a conflict between Claude’s snapshot and the audited pack, the audited pack wins.

---

## 8. Recommended remediation already applied in the audited pack

The audited replacement docs were designed to close exactly these gaps by:
- adding omitted functions
- correcting env names
- documenting hardcoded runtime dependencies
- correcting domain assumptions
- expanding storage/media coverage
- promoting exact inventory over approximation
- distinguishing the root `.env` from the true runtime env surface

---

## 9. Bottom line

Claude’s original snapshot was a strong first pass, but it is **not safe to treat as the sole rebuild dossier**.

The material issues were not philosophical or stylistic. They were practical:
- missing deployable functions
- incorrect secret names
- missing storage surfaces
- under-documented hardcoded production dependencies

That is why the audited pack is required as the canonical rebuild baseline.

