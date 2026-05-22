#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "legacy-cleanup" ]]; then
  shift
  exec npx tsx scripts/phase8-certification.ts legacy-cleanup "$@"
fi

exec npx tsx scripts/phase8-certification.ts rollout-step "$@"
