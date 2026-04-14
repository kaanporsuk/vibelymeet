# Minimal web E2E layer — 2026-04-14

## Framework

**Playwright** (`@playwright/test` 1.52.x) — one Chromium project, `webServer` starts Vite on `127.0.0.1:5173`.

## Exact files

| File | Role |
|------|------|
| `e2e/playwright.config.ts` | Config: `webServer` → `npm run dev`, base URL, single project |
| `e2e/web-smoke.spec.ts` | Two smoke tests: `/` and `/auth` shell render |
| `package.json` | `test:e2e` script (invokes `@playwright/test` CLI via `node …/cli.js`) |

**One-time (per machine / CI):** install browsers —  
`node node_modules/@playwright/test/node_modules/playwright/cli.js install chromium`  
(or ensure CI image caches Playwright browsers).

## Scope (minimum viable proof)

1. **Landing (`/`)** — HTTP 200, `body` visible (no white-screen crash).
2. **Auth shell (`/auth`)** — route loads; no full login (no secrets in repo).

**Why this slice:** Trust-critical for shipping is that the **bundled app boots** on primary entry routes after merges. Deeper flows (Ready Gate, Video Date, Daily Drop) still require **manual** `docs/golden-path-regression-runbook.md` or future authenticated fixtures + test project.

## Why not more in this pass

- Real Supabase auth in CI needs **vaulted test users** and stable preview URLs — a separate hardening track.
- Native E2E (Detox) is out of scope for this web-first slice.

## Run

```bash
npm run test:e2e
```
