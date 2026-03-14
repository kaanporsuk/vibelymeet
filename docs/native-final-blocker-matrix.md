# Native final blocker matrix (Sprint R4)

Categorized view of what blocks production-style validation vs what is acceptable or deferred. Use for go/no-go and prioritization.

---

## Blocker

Items that must be resolved before considering production or TestFlight-style validation.

| Item | Notes |
|------|--------|
| *(None in code)* | This sprint does not introduce new blockers. Production build, signing, and store submission are out of scope. |

*When moving to production:* Add store signing, EAS build profile, and TestFlight/Store checklist as blockers.

---

## Non-blocking known issue

Known issues that do not block release-readiness or dev validation. Fix when convenient.

| Item | Notes |
|------|--------|
| **RevenueCat offerings / dashboard** | Offerings or packages not fully configured; console warnings in dev. Premium screen and entitlement checks work; paywall may show empty or need dashboard setup before real purchases. |
| **Reset-password screen** | Placeholder or minimal flow; web has full flow. Document as P1 if needed. |
| **Still-missing native-v1 secondary surfaces** | Per contract: schedule tab, match celebration, public profile, vibe studio are deferred. Credits/subscription success are link-out or in-app browser. No P0 gap. |

---

## Deferred

Explicitly deferred; tracked but not in scope for this sprint.

| Item | Notes |
|------|--------|
| **Photo loading** | Bunny CDN returns 404 after path/provider work. Env and path-prefix support in place; CDN or dashboard path/origin still to be resolved. See `docs/native-runtime-stabilization-diagnosis.md`. |
| **Media / vibe video** | Bunny HLS; product-deferred. Video dates (Daily) implemented. |
| **Match celebration, public profile, vibe studio, schedule** | Per `docs/native-screen-contract-map.md`; deferred or link-out. |
| **Polish-only** | Accessibility, loading states, visual tweaks after v1 flows. |
| **Bunny/provider config** | No changes in this sprint; media tracked separately. |

---

## Dev-only artifact

Expected in dev builds only; not bugs and not present in production builds.

| Item | Notes |
|------|--------|
| **Expo dev client chrome** | Dev menu, reload, debug UI. Normal for dev client. |
| **RevenueCat dev warnings** | Configuration/offerings warnings when dashboard not fully set up. |
| **Photo URL trace logs** | `[Vibely photo URL]` in __DEV__; useful for diagnosis, not shipped to production. |

---

## Summary

- **Blocker:** None added this sprint; production/store path is out of scope.
- **Non-blocking:** RevenueCat dashboard gap, reset-password minimal state, deferred secondary surfaces (documented).
- **Deferred:** Photo loading (404), media/vibe video, schedule/public profile/vibe studio, polish, Bunny config.
- **Dev-only:** Dev client UI, RevenueCat warnings, trace logs.
