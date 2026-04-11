# Rebuild Rehearsal Log

Date: 2026-04-08  
Branch: `qa/authenticated-proof-and-rebuild-rehearsal`

## 1. Rehearsal status

Pass for local rebuild/install/build/static-smoke.  
Open gap for remote migration-parity replay because the documented helper requires a local `SUPABASE_DB_URL` source that is not present in this workspace.

## 2. Baseline under test

- Git commit under test: `2f06eca8bddf8c78794da31f44a557a270e5573d`
- Node version: `v20.20.1`
- npm version: `10.8.2`
- Supabase CLI version: `2.84.2`
- Linked project ref: `schdyxcunwcvddlcshwd`

## 3. Exact commands run

1. `git rev-parse HEAD`
2. `node -v`
3. `npm -v`
4. `supabase --version`
5. `ls -a | rg '^\.env' || true`
6. `supabase projects list --output json`
7. `supabase secrets list --project-ref schdyxcunwcvddlcshwd --output json`
8. `npm ci`
9. `./scripts/check_migration_parity.sh`
10. `npm run build`
11. `./scripts/run_golden_path_smoke.sh`
12. Production route fetches for:
    - `https://vibelymeet.com/OneSignalSDK.sw.js`
    - `https://vibelymeet.com/invite?ref=<smoke-profile-uuid>`
    - `https://vibelymeet.com/schedule`
    - `https://vibelymeet.com/vibe-studio`
13. Live SQL and log checks against the linked Supabase project

## 4. Results by stage

### Env assumptions check

- Present locally:
  - `.env.example`
  - `.env.local`
- Not present locally:
  - `.env.cursor.local`
  - `.env`
- Result: local frontend env exists, but the read-only migration parity helper cannot run without `SUPABASE_DB_URL` in `.env.cursor.local` or shell env.

### Linked project health

- `supabase projects list --output json`: linked project `schdyxcunwcvddlcshwd` reported `ACTIVE_HEALTHY`
- Result: PASS

### Secret-name presence check

- `supabase secrets list --project-ref schdyxcunwcvddlcshwd --output json` confirmed the expected names remain present, including:
  - Supabase core secrets
  - Bunny secrets
  - OneSignal secrets
  - Stripe secrets
  - Twilio secrets
  - hardening secrets
- Result: PASS for presence-only validation

### Clean dependency install

- `npm ci`: PASS
- Notes:
  - lockfile install succeeded cleanly
  - `npm audit` reported existing vulnerabilities, but install was successful and no rebuild blocker was introduced

### Migration parity inspection

- `./scripts/check_migration_parity.sh`: FAIL in current workspace
- Exact failure:
  - `SUPABASE_DB_URL is required. Set it in .env.cursor.local or the environment.`
- Result:
  - blocked for local parity-helper execution
  - not a code regression
  - this is a rebuild-assumption gap in the current workspace setup

### Production build

- `npm run build`: PASS
- Observed warnings:
  - Vite chunk-size warnings
  - Dynamic/static import chunking warnings
- Result: these warnings did not block the build

### Static golden-path smoke

- `./scripts/run_golden_path_smoke.sh`: PASS
- Included:
  - `npm run typecheck:core`
  - `npm run build`

### Production reachability smoke

- `https://vibelymeet.com/OneSignalSDK.sw.js`: PASS, returned expected root worker shim
- `https://vibelymeet.com/invite?ref=<uuid>`: PASS, returned live public auth shell
- `https://vibelymeet.com/schedule`: PASS for route reachability and auth gating, returned public auth shell when unauthenticated
- `https://vibelymeet.com/vibe-studio`: PASS for route reachability and auth gating, returned public auth shell when unauthenticated

## 5. Ambiguities and hidden assumptions found

- The rebuild docs assume local availability of `SUPABASE_DB_URL` for parity inspection, but this workspace does not currently provide it through `.env.cursor.local`.
- The workspace does contain `.env.local`, which is enough for frontend build/static smoke, but it is not sufficient for the parity helper.
- The repo contains no checked-in authenticated browser automation harness for canonical route proof.
- The repo documents smoke-user UUIDs in migrations, but the migration comments currently label the two smoke emails against the opposite UUIDs from the live `auth.users` data.

## 6. Missing or stale documentation discovered

- The rebuild runbook and checklist remain broadly usable.
- The specific local assumption for `SUPABASE_DB_URL` should remain called out explicitly whenever parity replay is part of the rehearsal.

## 7. Rebuild delta from this rehearsal

- No code or config changes were required to achieve install/build/static smoke.
- No Supabase deploy was required.
- No Vercel/hosting action was required for rebuild rehearsal.
- No provider-dashboard action was required to complete the local install/build/static portion.

## 8. Final judgment

- Rebuild rehearsal logged: yes
- Local rebuildability (install/build/static smoke): yes
- Full parity-helper replay from this workspace: not yet, due missing local `SUPABASE_DB_URL`
- Current baseline remains suitable for continued proof/closure work: yes

## 9. Follow-up closure pass — 2026-04-11

- **Git HEAD:** `3e1a2e5521af308bfac7f712b8fe2152d4641a24` (pre-commit snapshot during this pass; amend after your commit).
- **Node / npm:** `v20.20.1` / `10.8.2`
- **Commands re-run:** `npm install` (after removing `lovable-tagger`), `npm run typecheck`, `npm run build`.
- **Results:** typecheck PASS; web build PASS (same Vite chunk-size / dynamic-import notices as before — not regressions from this pass).
- **Doc alignment:** `docs/repo-hardening-closure-2026-04-11.md` is the dated record for removals and email-verification / shared-invoke truth. The earlier rehearsal baseline in §§1–3 remains historical; **authenticated browser smoke is still not a checked-in automated harness** — see §5–6 above.

## 10. Final closure sprint — `hardening/final-closure-sprint` (2026-04-11)

- **Isolation:** Unrelated product edits were **git stash**’d before this sprint; see `docs/hardening-final-closure-sprint-2026-04-11.md` for paths.
- **Re-ran:** `npm run typecheck`, `npm run build`, `npm run lint` (warning count 274 → 268 after targeted fixes).
- **Not re-ran:** Playwright `proof:browser-auth`, fresh smoke bootstrap, Supabase migration parity (`SUPABASE_DB_URL` still absent in typical workspace), Sign in with Apple end-to-end on web/native.
- **Docs touched (closure sprint):** `docs/active-doc-map.md`, `docs/vibely-canonical-project-reference.md`, `docs/browser-auth-runtime-proof-results.md` (status banner only), this file, `docs/hardening-final-closure-sprint-2026-04-11.md`, `_cursor_context/vibely_rebuild_runbook.md` (historical banner). **Follow-up:** final proof sprint updated `docs/browser-auth-runtime-proof-results.md` again — see §11.

## 11. Final proof sprint — runtime refresh (2026-04-11)

- **Re-ran:** `npm run proof:browser-auth` — **exit 0** (Playwright against production web with copied Chrome profile). Evidence table: `docs/browser-auth-runtime-proof-results.md` § “Fresh re-run — 2026-04-11”.
- **Not re-run:** `proof:smoke-bootstrap`, `proof:vibe-upload-processing`, Supabase parity helper, native builds.
- **Not executable in automation here:** Sign in with Apple + email OTP send/receive/verify on web and native (requires human Apple ID + mail access + device/simulator).
