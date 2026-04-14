#!/usr/bin/env bash
# Regenerate src/integrations/supabase/types.ts from the linked Supabase project's public schema.
# Requires network + Supabase CLI (`npx supabase`).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/src/integrations/supabase/types.ts"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
npx supabase gen types typescript --project-id schdyxcunwcvddlcshwd --schema public >"$TMP"
{
  printf '%s\n' \
    '/**' \
    ' * Supabase `public` schema types — generated from the linked project.' \
    ' *' \
    ' * Regenerate:' \
    ' *   ./scripts/regen-supabase-types.sh' \
    ' *' \
    ' * Project id matches supabase/config.toml (linked).' \
    ' */' \
    ''
  cat "$TMP"
} >"$OUT"
echo "Wrote $OUT"
