# Native decision log

Decisions made for the native architecture and Sprint 0. **Rejected options** are listed explicitly so the same debate is not reopened without a formal change to this log.

---

## Architecture and repo

| Decision | Rejected alternative | Rationale |
|----------|----------------------|-----------|
| **Current repo:** Monorepo; web in `src/`, native in `apps/mobile`, backend in `supabase/` | Separate repo for mobile; moving web into `apps/web` now | Single repo keeps contracts visible and avoids drift; no broad refactor. |
| **`apps/mobile`** is the seed of the future universal user-facing app | New greenfield app; RN CLI instead of Expo | Already exists; runs on iPhone; Android EAS build has succeeded. Expo chosen for tooling and EAS. |
| **Legacy web remains production safety net** | Deprecate web or remove routes | No route removal; web and native share backend. |
| **Admin / legal / marketing remain web-only** | Rebuild admin or legal in native | Out of scope for v1; link out from native where needed. |
| **Shared backend unchanged** for Sprint 0 | New “mobile” Supabase project; mobile-only RPCs for core domains | One system of record; no client-owned business logic. |

---

## Providers (locked)

| Decision | Rejected alternative | Rationale |
|----------|----------------------|-----------|
| **Native payments: RevenueCat** | Stripe only; other IAP middlewares | Locked; no provider swap. |
| **Notifications: OneSignal** | FCM/APNs only; other push providers | Locked; same as web where applicable. |
| **Video: Daily** | Twilio; other video SDKs | Locked; no provider swap. |
| **Backend: Supabase** | Custom backend; other BaaS | Locked. |
| **Media: Bunny** | S3; other CDN | Locked; same upload/URL contract. |
| **Bundle ID: com.vibelymeet.vibely** | Different ID | Locked per project. |

---

## Implementation order

| Decision | Rejected alternative | Rationale |
|----------|----------------------|-----------|
| **Sprint order: UI-1 → UI-2 → UI-3 → UI-4 → UI-5 → UI-6** (primitives, dashboard+shell, profile+settings, matches+chat, events/lobby, premium+roughness) | Different order (e.g. events first); single big sprint | Primitives and shell first; then profile/settings; then social (matches/chat); then discovery (events/lobby); then premium and polish. |
| **UI-1 = shared design primitives** | Skip primitives; copy-paste per screen | One design system reduces drift and rework. |
| **UI-2 = dashboard + shell** | Start with events or matches | Shell and auth gates are prerequisite for all screens. |

---

## Docs and process

| Decision | Rejected alternative | Rationale |
|----------|----------------------|-----------|
| **Web as product/design source of truth** | Native-first design; divergent UX | Parity target; no redesign in Sprint 0. |
| **Golden-path harness on main is canonical** | Keep harness only on feature branch | Already on main; no merge step. |
| **`.npmrc` legacy-peer-deps=true in apps/mobile** retained and documented | Remove without fix; or hide in CI only | EAS install fails without it (Daily/Expo 55 peer conflict). Document until Daily has Expo 55–compatible plugin or real fix. See `apps/mobile/README.md`. |
| **Sprint 0 = docs branch only; no feature implementation** | Implement features in same branch | Architecture lock only; no refactors, no dependency churn. |

---

## Scope

| Decision | Rejected alternative | Rationale |
|----------|----------------------|-----------|
| **No schema/Edge Function changes** in Sprint 0 unless necessary to document current state | Add new columns or functions “for native” | Document actual state; no backend change in this sprint. |
| **No route removal** | Remove or consolidate web routes | Safety net; all existing routes stay. |
| **No broad refactors; no dependency churn** | Upgrade all deps; move to pnpm workspaces | Guardrails; minimize risk. |

---

## Updating this log

To reopen a decision: add a new row or subsection with **Decision**, **Rejected alternative**, and **Rationale**. Do not remove existing entries; amend with “Superseded by: …” if a decision is explicitly reversed later.
