#!/usr/bin/env bash
# Chat Vibe Clip smoke matrix runner.
# Safe by default: static/contract checks run everywhere; live staging rows require explicit env.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/run_chat_vibe_clip_smoke_matrix.sh [--dry-run|--web|--native|--all]

Modes:
  --dry-run  Default. Runs contract/static checks and prints the live matrix requirements.
  --web      Runs the Playwright web rows tagged @chat-vibe-clip.
  --native   Runs the Maestro native entry flow when MAESTRO_RUN=1 and native env is present.
  --all      Runs dry-run checks, then web, then native.

Live web env:
  VIBELY_CVC_SMOKE=1
  VIBELY_CVC_WEB_CHAT_URL=https://<staging-host>/chat/<matched-profile-id>
  VIBELY_CVC_WEB_STORAGE_STATE=/absolute/path/to/playwright-storage-state.json
  VIBELY_CVC_FIXTURE_VIDEO=/absolute/path/to/short-valid-video.mp4
  VIBELY_CVC_STUCK_CLIENT_REQUEST_ID=<uuid> # only for app-launch-stuck-processing-nudge
  VIBELY_CVC_DISRUPTION_SMOKE=1        # only for kill-mid-tus
  VIBELY_CVC_EXPECT_READY=1            # optional stricter webhook-delayed assertion

Live native env:
  VIBELY_CVC_NATIVE_SMOKE=1
  VIBELY_CVC_NATIVE_CHAT_DEEPLINK=vibely://chat/<matched-profile-id>
  VIBELY_CVC_NATIVE_SCENARIO_ID=<scenario-id> # optional; --native runs all scenarios when unset
  VIBELY_CVC_NATIVE_SCENARIO_DEEPLINK=vibely://chat/<matched-profile-id>?smokeScenario=<scenario-id> # runner-set
  EXPO_PUBLIC_VIBELY_CVC_NATIVE_FIXTURE_UPLOAD=1
  EXPO_PUBLIC_VIBELY_CVC_NATIVE_FIXTURE_URL=https://<staging-host>/fixtures/chat-vibe-clip.mp4
  VIBELY_CVC_NATIVE_FIXTURE_UPLOAD=1      # accepted by this runner; app builds should use EXPO_PUBLIC_*
  VIBELY_CVC_NATIVE_FIXTURE_URL=https://<staging-host>/fixtures/chat-vibe-clip.mp4
  MAESTRO_RUN=1

Scenario ids:
  happy-path
  4g-throttle
  kill-mid-tus
  webhook-delayed
  signed-url-mid-expiry
  app-launch-stuck-processing-nudge
USAGE
}

CHAT_VIBE_CLIP_SCENARIOS=(
  happy-path
  4g-throttle
  kill-mid-tus
  webhook-delayed
  signed-url-mid-expiry
  app-launch-stuck-processing-nudge
)

is_known_chat_vibe_clip_scenario() {
  local candidate="$1"
  local scenario
  for scenario in "${CHAT_VIBE_CLIP_SCENARIOS[@]}"; do
    [[ "$scenario" == "$candidate" ]] && return 0
  done
  return 1
}

native_scenario_deeplink() {
  local scenario="$1"
  local separator="?"
  if [[ "$VIBELY_CVC_NATIVE_CHAT_DEEPLINK" == *\?* ]]; then
    separator="&"
  fi
  printf '%s%ssmokeScenario=%s' "$VIBELY_CVC_NATIVE_CHAT_DEEPLINK" "$separator" "$scenario"
}

MODE="dry-run"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      MODE="dry-run"
      ;;
    --web)
      MODE="web"
      ;;
    --native)
      MODE="native"
      ;;
    --all)
      MODE="all"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

run_step() {
  echo
  echo "==> $*"
  "$@"
}

run_static() {
  run_step npm run test:vibe-clip-upload-contract
  run_step npx tsx shared/chat/vibeClipSmokeMatrix.test.ts
  echo
  echo "Chat Vibe Clip live smoke matrix is defined for:"
  local scenarios_csv
  scenarios_csv=""
  local scenario
  for scenario in "${CHAT_VIBE_CLIP_SCENARIOS[@]}"; do
    [[ -n "$scenarios_csv" ]] && scenarios_csv+=", "
    scenarios_csv+="$scenario"
  done
  echo "  web: ${scenarios_csv}"
  echo "  ios: ${scenarios_csv}"
  echo "  android: ${scenarios_csv}"
}

run_web() {
  if [[ "${VIBELY_CVC_SMOKE:-}" != "1" ]]; then
    echo "Refusing live web smoke without VIBELY_CVC_SMOKE=1." >&2
    exit 1
  fi
  run_step node ./node_modules/@playwright/test/cli.js test -c e2e/playwright.config.ts --grep @chat-vibe-clip
}

run_native() {
  if [[ "${VIBELY_CVC_NATIVE_SMOKE:-}" != "1" || "${MAESTRO_RUN:-}" != "1" ]]; then
    echo "Refusing native smoke without VIBELY_CVC_NATIVE_SMOKE=1 and MAESTRO_RUN=1." >&2
    exit 1
  fi
  if [[ -z "${VIBELY_CVC_NATIVE_CHAT_DEEPLINK:-}" ]]; then
    echo "Missing VIBELY_CVC_NATIVE_CHAT_DEEPLINK." >&2
    exit 1
  fi
  local fixture_upload="${EXPO_PUBLIC_VIBELY_CVC_NATIVE_FIXTURE_UPLOAD:-${VIBELY_CVC_NATIVE_FIXTURE_UPLOAD:-}}"
  local fixture_url="${EXPO_PUBLIC_VIBELY_CVC_NATIVE_FIXTURE_URL:-${VIBELY_CVC_NATIVE_FIXTURE_URL:-}}"
  if [[ "$fixture_upload" != "1" || -z "$fixture_url" ]]; then
    echo "Missing EXPO_PUBLIC_VIBELY_CVC_NATIVE_FIXTURE_UPLOAD=1 or EXPO_PUBLIC_VIBELY_CVC_NATIVE_FIXTURE_URL." >&2
    exit 1
  fi
  if ! command -v maestro >/dev/null 2>&1; then
    echo "MAESTRO_RUN=1 but maestro is not in PATH." >&2
    exit 1
  fi
  run_step bash apps/mobile/scripts/rc-smoke-check.sh
  local native_scenarios=("${CHAT_VIBE_CLIP_SCENARIOS[@]}")
  if [[ -n "${VIBELY_CVC_NATIVE_SCENARIO_ID:-}" ]]; then
    if ! is_known_chat_vibe_clip_scenario "$VIBELY_CVC_NATIVE_SCENARIO_ID"; then
      echo "Unknown VIBELY_CVC_NATIVE_SCENARIO_ID: ${VIBELY_CVC_NATIVE_SCENARIO_ID}" >&2
      exit 1
    fi
    native_scenarios=("${VIBELY_CVC_NATIVE_SCENARIO_ID}")
  fi
  for native_scenario in "${native_scenarios[@]}"; do
    echo
    echo "==> native Chat Vibe Clip scenario: ${native_scenario}"
    (
      export VIBELY_CVC_NATIVE_SCENARIO_ID="${native_scenario}"
      export VIBELY_CVC_NATIVE_SCENARIO_DEEPLINK
      VIBELY_CVC_NATIVE_SCENARIO_DEEPLINK="$(native_scenario_deeplink "${native_scenario}")"
      cd apps/mobile
      maestro test maestro/chat-vibe-clip-smoke.yaml
    )
  done
}

case "$MODE" in
  dry-run)
    run_static
    ;;
  web)
    run_static
    run_web
    ;;
  native)
    run_static
    run_native
    ;;
  all)
    run_static
    run_web
    run_native
    ;;
esac
