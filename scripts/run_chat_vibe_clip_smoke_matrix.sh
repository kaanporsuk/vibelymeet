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
  VIBELY_CVC_DISRUPTION_SMOKE=1        # only for kill-mid-tus
  VIBELY_CVC_EXPECT_READY=1            # optional stricter webhook-delayed assertion

Live native env:
  VIBELY_CVC_NATIVE_SMOKE=1
  VIBELY_CVC_NATIVE_CHAT_DEEPLINK=vibely://chat/<matched-profile-id>
  MAESTRO_RUN=1

Scenario ids:
  happy-path
  4g-throttle
  kill-mid-tus
  webhook-delayed
USAGE
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
  echo "  web: happy-path, 4g-throttle, kill-mid-tus, webhook-delayed"
  echo "  ios: happy-path, 4g-throttle, kill-mid-tus, webhook-delayed"
  echo "  android: happy-path, 4g-throttle, kill-mid-tus, webhook-delayed"
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
  if ! command -v maestro >/dev/null 2>&1; then
    echo "MAESTRO_RUN=1 but maestro is not in PATH." >&2
    exit 1
  fi
  run_step bash apps/mobile/scripts/rc-smoke-check.sh
  run_step bash -lc "cd apps/mobile && maestro test maestro/chat-vibe-clip-smoke.yaml"
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

