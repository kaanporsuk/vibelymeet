# Fresh Smoke Proof Bootstrap

Date: 2026-04-08  
Branch: `qa/fresh-smoke-proof-bootstrap`

## 1. Goal

Provide a repeatable repo-side bootstrap for the remaining smoke/data-dependent browser proofs without depending on stale Chrome auth artifacts.

Primary entrypoint:

- `npm run proof:smoke-bootstrap`

Dedicated Vibe Studio binary proof:

- `npm run proof:vibe-upload-processing`

Cleanup/reset only:

- `node scripts/fresh-smoke-proof-bootstrap.mjs cleanup`

## 2. What the bootstrap does

`scripts/fresh-smoke-proof-bootstrap.mjs` performs the smallest effective end-to-end bootstrap for the documented smoke pair:

- writes or refreshes an untracked local `.env.cursor.local`
- resets fresh password hashes for:
  - `2cf4a5af-acc7-4450-899d-0c7dc85139e2` / `kaanporsuk@gmail.com`
  - `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c` / `direklocal@gmail.com`
- uses `supabase db query --linked` to:
  - reset `profiles.referred_by`
  - clean tagged smoke-proof rows for the smoke match
  - remove recent null-revision leftovers from failed bootstrap attempts
- signs in fresh with password grant against the linked Supabase project
- seeds tagged schedule proof state through the real server-owned `date-suggestion-actions` path:
  - one pending suggestion
  - one accepted upcoming plan
  - one accepted past plan
- runs fresh-session Playwright proof against:
  - `/schedule`
  - `/dashboard`
  - `/invite?ref=...` -> `/auth?ref=...` -> `/settings/referrals`
  - `/vibe-studio`
  - `/user/:userId`

The dedicated Vibe Studio closure harness `scripts/fresh-vibe-upload-processing-proof.mjs` reuses the same smoke pair, keeps the primary ready account untouched as control, and drives the reversible partner account through:

- cleanup back to `bunny_video_status='none'`
- fresh `create-video-upload` + real Bunny tus upload
- observed `processing -> ready`
- replace to a new `bunny_video_uid`
- final cleanup back to `none`

No schema migration or deploy is required for this bootstrap. It uses linked SQL execution plus existing runtime routes/functions.

## 3. Proof dependency audit

| Proof target | Required auth/session state | Required data state | Can Cursor bootstrap this now |
|---|---|---|---|
| Schedule non-empty pending/upcoming/history | Fresh authenticated `kaanporsuk@gmail.com` browser session | Tagged smoke suggestions/plans on match `06eab9bc-fabc-4580-9192-98b636f64a89` | Yes |
| Schedule reminder-routing truth | Fresh authenticated `kaanporsuk@gmail.com` browser session | Accepted upcoming tagged plan starting within the next hour | Yes |
| Referrals set-once attribution | Fresh authenticated `direklocal@gmail.com` target session plus `kaanporsuk@gmail.com` referrer id | `profiles.referred_by = null` before proof | Yes |
| Referrals self-ref rejection | Fresh authenticated `kaanporsuk@gmail.com` browser session | No special data beyond clean local referral storage | Yes |
| Vibe Studio ready render + caption save/revert | Fresh authenticated `kaanporsuk@gmail.com` browser session | Existing ready Vibe video on the primary smoke profile | Yes |
| Vibe Studio create/upload entry + delete cleanup | Fresh authenticated `direklocal@gmail.com` browser session | Complete profile with no active video | Yes |
| Public profile route render | Fresh authenticated `direklocal@gmail.com` browser session viewing `kaanporsuk@gmail.com` | Existing complete public profile data on the primary smoke account | Yes |
| Vibe Studio binary upload -> processing -> ready / replace | Fresh authenticated browser session plus safe reversible media account | Real tus upload + webhook-ready completion + safe replace target | Yes, via `npm run proof:vibe-upload-processing` |
| OneSignal prompt grant + delivered click | Interactive non-headless browser/device session | Real permission grant + delivered notification | No |

## 4. What is now hard-proved by the bootstrap

- Fresh smoke auth is reproducible without stale Chrome refresh tokens.
- `/schedule` renders non-empty `Pending`, `Upcoming`, and `History` buckets for the smoke pair.
- `/schedule` and `/dashboard` both render the upcoming-date reminder/countdown truth from the accepted smoke plan.
- `/invite?ref=` stores the referrer id, `/auth?ref=` applies server-owned attribution after fresh auth, `/settings/referrals` shows the linked inviter, and repeat/self-ref attempts do not corrupt `referred_by`.
- `/vibe-studio` renders the ready state for the primary smoke account, saves/reverts caption text, and safely proves create/upload-entry plus delete cleanup on the partner smoke account.
- `npm run proof:vibe-upload-processing` generates real `video/webm` assets in headless Chromium, proves fresh Bunny tus upload through observed `processing -> ready`, proves replace with a new uid and abandoned prior session, and restores the reversible partner account back to `none`.
- `/user/:userId` renders the primary smoke profile from an authenticated partner session, including name/age, tagline, photo verification, ready Vibe Video caption, About Me, vibes, and lifestyle sections without falling into the not-found shell.

## 5. Explicit exclusions

This bootstrap does **not** fake closure for manual/provider/device work:

- human-granted browser push prompt acceptance
- delivered notification click/deep-link interaction
- RevenueCat dashboard/store setup
- OneSignal mobile dashboard setup
- EAS/device validation

`npm run proof:smoke-bootstrap` itself still does not perform the long binary upload/replace cycle; that closure now lives in the dedicated `npm run proof:vibe-upload-processing` harness.
