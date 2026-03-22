# Vercel manual setup (dashboard & DNS only)

Actions below must be done in the **Vercel dashboard** or at your **DNS registrar**. The codebase cannot complete these steps for you.

### Account security

1. Enable 2FA: Vercel Dashboard → **Settings** → **Security** → Enable 2FA.
2. Add a passkey (optional): **Settings** → **Security** → **Add Passkey**.

### Project settings (verify)

1. **Framework Preset:** Vite (or “Other” with the commands below).
2. **Root Directory:** `.` (repository root — the Vite app lives at the root next to `index.html`, not under `apps/mobile`).
3. **Build Command:** `npm run build` (runs `vite build`).
4. **Output Directory:** `dist` (Vite default).
5. **Install Command:** `npm install` (default).
6. **Node.js Version:** 18.x or 20.x (match your team standard; no `engines` field in root `package.json`).
7. **Production Branch:** `main` (or your default branch — align with Git).

### Environment variables

1. Open **Project** → **Settings** → **Environment Variables**.
2. Add each variable from [`vercel-env-inventory.md`](./vercel-env-inventory.md) for the correct environments (Production / Preview / Development as needed).
3. After saving, trigger a **redeploy** so new values are picked up.

### Domains

1. **Project** → **Settings** → **Domains**.
2. Add **www.vibelymeet.com** as the primary host (recommended: CNAME to Vercel).
3. Add **vibelymeet.com** and configure a redirect to `https://www.vibelymeet.com` (or your preferred canonical URL).

**DNS records** (at your registrar; exact values may be shown in the Vercel domain UI):

- **CNAME:** `www` → `cname.vercel-dns.com` (or the target Vercel shows).
- **Apex (@):** Often **A** → `76.76.21.21` for Vercel, or use the registrar’s ALIAS/ANAME to Vercel — follow Vercel’s wizard for apex domains.

### Preview protection

1. **Project** → **Settings** → **Deployment Protection**.
2. Enable **Vercel Authentication** for Preview deployments if you want previews behind login.
3. Keep **Logs and Source Protection** ON if available.
4. Keep **Git Fork Protection** ON if your org uses it.

### Analytics activation

1. **Project** → **Analytics** → Enable **Web Analytics** for the project.
2. **Project** → **Speed Insights** → Enable **Speed Insights**.
3. Deploy the app with `@vercel/analytics` and `@vercel/speed-insights` installed and wired (see root `App.tsx`).
4. Visit the production site and navigate a few routes.
5. Data typically appears in both dashboards within a few minutes.

**Note:** PostHog remains configured in code alongside Vercel Web Analytics; both can run together.
