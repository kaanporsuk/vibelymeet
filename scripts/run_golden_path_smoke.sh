#!/usr/bin/env bash
# Golden-path smoke: static checks + pointer to manual runbook.
# Run from repo root. For full regression, follow docs/golden-path-regression-runbook.md after this script succeeds.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Golden-path smoke (static) ==="
echo

echo "1. Typecheck (tsconfig.core-strict)..."
npm run typecheck:core
echo "   OK"
echo

echo "2. Build..."
npm run build
echo "   OK"
echo

echo "=== Static checks passed. ==="
echo "For full regression, run the steps in: docs/golden-path-regression-runbook.md"
echo "  (Auth, Pause/Resume, Ready Gate, Video-date, Daily Drop, Chat, Swipe, Premium, Admin.)"
