# Vibely (VibelyMeet)

Monorepo for the Vibely dating product: **web** (Vite + React), **native** (Expo in `apps/mobile/`), and **Supabase** (Postgres, Edge Functions, RLS).

## Documentation

- **Where to start:** [`docs/active-doc-map.md`](docs/active-doc-map.md)
- **Architecture and import boundaries:** [`docs/vibely-canonical-project-reference.md`](docs/vibely-canonical-project-reference.md)

## Prerequisites

- Node.js 20+ and npm
- For native: Xcode (iOS), Android Studio / SDK (Android), Expo tooling as in `apps/mobile/README.md`

## Install

```sh
npm ci
cd apps/mobile && npm ci && cd ../..
```

## Common commands (repo root)

| Command | Purpose |
|--------|---------|
| `npm run dev` | Web dev server (Vite) |
| `npm run build` | Production web build |
| `npm run typecheck` | Web strict core + mobile + app TS |
| `npm run lint` | ESLint |
| `npm run launch:preflight` | Native launch checks (see doc map) |

## Environments

Copy `.env.example` to `.env.local` for web; use `apps/mobile` env patterns for native. Secrets for Supabase Edge Functions are **not** committed — set in Supabase dashboard or `supabase secrets`.

## Domains & hosting

Production web is deployed with production env (e.g. Vercel) targeting **`vibelymeet.com`**. Push uses OneSignal; see [`docs/web-push-production-checklist.md`](docs/web-push-production-checklist.md).

## License

Private — All rights reserved.
