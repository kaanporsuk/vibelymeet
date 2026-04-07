#!/usr/bin/env bash
# Native RC smoke: static checks always; Maestro only when MAESTRO_RUN=1 and CLI exists.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_ROOT/../.." && pwd)"

cd "$MOBILE_ROOT"
echo "[rc-smoke] apps/mobile typecheck…"
npm run typecheck
echo "[rc-smoke] eslint (RC-touched surfaces)…"
cd "$REPO_ROOT"
npx eslint \
  apps/mobile/lib/nativeRcDiagnostics.ts \
  apps/mobile/app/index.tsx \
  apps/mobile/context/AuthContext.tsx \
  apps/mobile/app/_layout.tsx \
  apps/mobile/components/NotificationDeepLinkHandler.tsx \
  "apps/mobile/app/(onboarding)/index.tsx" \
  "apps/mobile/app/ready/[id].tsx" \
  apps/mobile/components/lobby/ReadyGateOverlay.tsx \
  "apps/mobile/app/event/[eventId]/lobby.tsx" \
  apps/mobile/lib/readyGateApi.ts

if [[ "${MAESTRO_RUN:-}" == "1" ]]; then
  if command -v maestro >/dev/null 2>&1; then
    echo "[rc-smoke] Maestro native-rc-smoke.yaml…"
    cd "$MOBILE_ROOT"
    maestro test maestro/native-rc-smoke.yaml
  else
    echo "[rc-smoke] MAESTRO_RUN=1 but maestro not in PATH — skip device flow."
    exit 1
  fi
else
  echo "[rc-smoke] Done (set MAESTRO_RUN=1 with Maestro installed to run device smoke)."
fi
