# Native release validation (RC)

Repeatable checks before promoting a native build (TestFlight / Play internal / production).

## Automated / CI-friendly

From repo root:

```bash
chmod +x apps/mobile/scripts/rc-smoke-check.sh
apps/mobile/scripts/rc-smoke-check.sh
```

Or from `apps/mobile`: `npm run rc-smoke`.

This runs `apps/mobile` TypeScript `typecheck` and ESLint on RC-touched surfaces.

### Optional: Maestro device smoke

Requires [Maestro](https://maestro.mobile.dev) and a running simulator/emulator with the app installed.

```bash
cd apps/mobile
MAESTRO_RUN=1 ./scripts/rc-smoke-check.sh
# or directly:
maestro test maestro/native-rc-smoke.yaml
```

`native-rc-smoke.yaml` only asserts a cold launch reaches the sign-in welcome shell (`Welcome to Vibely!`). Extend flows incrementally; keep each flow focused.

## Manual golden path (minimum)

Use a staging or RC build with staging Supabase.

1. **Auth**: Sign in → cold start → session restores; password recovery opens in-app reset when link returns `recovery`.
2. **Boot routing**: Incomplete onboarding → onboarding; complete → tabs; missing entry state → entry recovery.
3. **Push / inbox**: Tap notification with `data.url` → navigates; foreground chat suppression — no duplicate banner when already on thread (verify visually).
4. **Onboarding**: Reach finalize → success or error with retry / back; draft sync banner if offline (if applicable).
5. **Event → lobby → ready → date**: Enter live lobby → match → ready overlay → both ready → date room opens (or forfeit returns to lobby).

## Sentry breadcrumbs (filtering)

RC instrumentation uses stable `category` prefixes:

| Category | When |
|----------|------|
| `rc.auth.boot` | Root index route decided (sign-in vs onboarding vs tabs vs recovery). |
| `rc.auth.entry_state` | `resolve_entry_state` completed after auth. |
| `rc.auth.redirect_url` | OAuth / magic-link / recovery URL handled by `completeSessionFromAuthReturnUrl`. |
| `rc.notif.deep_link` | OneSignal open navigates or cannot resolve href; foreground suppression. |
| `rc.onboarding.finalize` | Onboarding `finalize_onboarding` attempt / outcome / retry. |
| `rc.ready_gate` | Invalid ready session; both-ready navigation to date; forfeited; mark-ready RPC error. |
| `rc.lobby.date_entry` | Lobby navigates from ready gate to `/date/:id`. |

Existing feature areas (e.g. `video-date`) keep their own categories.

## Rollout note

Breadcrumbs ship in JS — **OTA-eligible** with a normal JS bundle update. Maestro and this script are host-side; no app binary change required for diagnostics alone.
