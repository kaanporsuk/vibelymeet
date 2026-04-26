#!/usr/bin/env bash
# Golden-path smoke: repo-local prerequisites plus optional video-date hardening checks.
# Run from repo root.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/run_golden_path_smoke.sh [--quick|--video-date|--full] [--db-dry-run]

Modes:
  --quick       Default. Core typecheck + production build.
  --video-date  Runs the video-date hardening regression commands from the closure handoff.
  --full        Runs full typecheck/lint/build plus video-date hardening tests.

Options:
  --db-dry-run  Also run `supabase db push --linked --dry-run`.
  --help        Show this help.

Notes:
  - This script does not deploy anything.
  - Browser/device flows remain manual unless an existing test command is run separately.
USAGE
}

MODE="quick"
RUN_DB_DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick)
      MODE="quick"
      ;;
    --video-date)
      MODE="video-date"
      ;;
    --full)
      MODE="full"
      ;;
    --db-dry-run)
      RUN_DB_DRY_RUN=1
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

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing required golden-path file: $path" >&2
    exit 1
  fi
}

echo "=== Golden-path smoke (${MODE}) ==="

require_file "docs/golden-path-regression-runbook.md"
require_file "docs/video-date-hardening-closure-handoff.md"
require_file "shared/matching/videoDateEndToEndHardening.test.ts"
require_file "shared/matching/readyGateCountdown.test.ts"
require_file "shared/observability/videoDateOperatorMetrics.test.ts"
require_file "supabase/functions/_shared/admin-video-date-ops.test.ts"

case "$MODE" in
  quick)
    run_step npm run typecheck:core
    run_step npm run build
    ;;
  video-date)
    run_step npm run typecheck
    run_step npm run lint -- --quiet
    run_step npm run build
    run_step npx tsx --test shared/matching/videoDateEndToEndHardening.test.ts
    run_step npx tsx --test shared/matching/readyGateCountdown.test.ts
    run_step npx tsx --test shared/observability/videoDateOperatorMetrics.test.ts
    run_step npx tsx --test supabase/functions/_shared/admin-video-date-ops.test.ts
    run_step git diff --check
    ;;
  full)
    run_step npm run typecheck
    run_step npm run lint -- --quiet
    run_step npm run build
    run_step npx tsx --test shared/matching/videoDateEndToEndHardening.test.ts
    run_step npx tsx --test shared/matching/readyGateCountdown.test.ts
    run_step npx tsx --test shared/observability/videoDateOperatorMetrics.test.ts
    run_step npx tsx --test supabase/functions/_shared/admin-video-date-ops.test.ts
    run_step git diff --check
    echo
    echo "Optional shell/browser smoke still available separately:"
    echo "  npm run test:e2e"
    echo "  cd apps/mobile && MAESTRO_RUN=1 npm run rc-smoke"
    ;;
esac

if [[ "$RUN_DB_DRY_RUN" == "1" ]]; then
  run_step supabase db push --linked --dry-run
fi

echo
echo "=== Golden-path smoke passed (${MODE}). ==="
echo "Manual flow checklist: docs/golden-path-regression-runbook.md"
