# Vercel Environment Variable Inventory

Scan scope: `src/` (Vite web app). All `VITE_*` variables are embedded in the client bundle at build time and are **visible in the browser** — only use public keys and safe values.

`process.env` does not appear in `src/`; the web app uses `import.meta.env` only.

Built-in Vite flags (not set in the Vercel UI): `import.meta.env.DEV`, `import.meta.env.PROD`, `import.meta.env.MODE`, `import.meta.env.SSR`.

| Variable | Used In | Required | Client/Server | Environments |
|----------|---------|----------|---------------|--------------|
| `VITE_SUPABASE_URL` | `integrations/supabase/client.ts`, upload services, edge function URLs, `healthUrl.ts`, `DeleteAccountWeb.tsx`, etc. | Yes | Client | Prod, Preview, Development |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `integrations/supabase/client.ts` (preferred key) | Yes* | Client | Prod, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | `integrations/supabase/client.ts` (legacy fallback if publishable unset) | Yes* | Client | Prod, Preview, Development |
| `VITE_BUNNY_CDN_HOSTNAME` | `utils/imageUrl.ts`, `components/ui/ProfilePhoto.tsx` | Yes† | Client | Prod, Preview, Development |
| `VITE_BUNNY_CDN_PATH_PREFIX` | `utils/imageUrl.ts` (optional path segment) | No | Client | Prod, Preview, Development |
| `VITE_BUNNY_STREAM_CDN_HOSTNAME` | Profile/video components, admin previews, `VibeStudioModal.tsx`, etc. | Yes† | Client | Prod, Preview, Development |
| `VITE_POSTHOG_API_KEY` | `main.tsx` (`posthog.init`) | Yes‡ | Client | Prod, Preview, Development |
| `VITE_POSTHOG_HOST` | `main.tsx` (defaults to `https://eu.i.posthog.com` if unset) | No | Client | Prod, Preview, Development |
| `VITE_SENTRY_DSN` | `main.tsx` (DSN fallback exists in code if unset) | No | Client | Prod, Preview, Development |
| `VITE_ONESIGNAL_APP_ID` | `lib/onesignal.ts` (fallback in code if unset) | No | Client | Prod, Preview, Development |
| `VITE_APP_VERSION` | Injected by `vite.config.ts` `define` from `package.json`; `FeedbackDrawer.tsx` | No (build-time) | Client | All builds |

\* At least one of `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY` must be non-empty for Supabase auth/data to work.

† Bunny CDN hostnames are required for correct images and HLS video URLs wherever those features are used; local/dev may omit only if those code paths are not exercised.

‡ PostHog initializes with the key from env; use a real key in production for analytics. Localhost opts out in code (`main.tsx`).

### Safe for client (VITE\_ prefix)

All variables above are intended for the browser bundle. Do **not** put secrets (service role keys, Twilio tokens, etc.) in `VITE_*` — see `.env.example` in the repo root.

### Server-only

This Vite SPA does not use Vercel serverless functions in-repo for the main app; there is **no** `process.env` usage under `src/`. Any future server-side code would use non-`VITE_` vars and must not be prefixed with `VITE_` if they must stay secret.
