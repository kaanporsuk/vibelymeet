# Mobile app — Sprint 1 foundation

Sprint 1 adds the native app shell at **`apps/mobile`** (Expo + React Native + TypeScript + Expo Router), wired to the same Supabase backend as web.

- **Structure, run instructions, env vars, scope:** see **`apps/mobile/README.md`**.
- **Architecture and route mapping:** see **`docs/native-build-architecture-plan.md`**.

No root workspace or monorepo was introduced; the web app remains at repo root. Run the mobile app from `apps/mobile` with `npm start` after setting `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

**Sprint 2:** Profile, onboarding, events, and attendee discovery — see **`docs/mobile-sprint2.md`**.
