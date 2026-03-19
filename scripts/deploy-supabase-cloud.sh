#!/usr/bin/env bash
# Deploy DB migrations and/or all Edge Functions to Supabase cloud.
# Target project is fixed to MVP_Vibe — edit EXPECTED_REF if you fork.
set -euo pipefail

EXPECTED_REF="schdyxcunwcvddlcshwd"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ACTUAL="$(grep -E '^project_id\s*=' supabase/config.toml | head -1 | sed 's/.*"\([^"]*\)".*/\1/')"
if [[ "$ACTUAL" != "$EXPECTED_REF" ]]; then
  echo "Abort: supabase/config.toml project_id=$ACTUAL (expected $EXPECTED_REF)"
  exit 1
fi

DB=1
FUNCS=1
case "${1:-}" in
  --db-only) FUNCS=0 ;;
  --functions-only) DB=0 ;;
  --help|-h)
    echo "Usage: $0 [--db-only | --functions-only]"
    echo "  (no args)     db push + deploy all functions"
    echo "  --db-only     supabase db push --linked only"
    echo "  --functions-only  deploy every function under supabase/functions/"
    exit 0
    ;;
esac

if [[ "$DB" -eq 1 ]]; then
  echo "=== DB push (linked) ==="
  supabase db push --linked
fi

if [[ "$FUNCS" -eq 1 ]]; then
  echo "=== Edge Functions → $EXPECTED_REF ==="
  for dir in "$ROOT"/supabase/functions/*/; do
    name="$(basename "$dir")"
    [[ "$name" == "_shared" ]] && continue
    echo "--- deploy $name ---"
    supabase functions deploy "$name" --project-ref "$EXPECTED_REF"
  done
  echo "Done."
fi
