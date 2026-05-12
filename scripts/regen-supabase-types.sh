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

# Supabase CLI emits scalar RPC returns as non-nullable, but this SQL function
# intentionally returns NULL for unknown capability keys.
perl -0pi -e 's/(tier_capability_type:\s*\{\s*Args:\s*\{\s*p_capability_key:\s*string\s*\}\s*Returns:\s*)string(\s*\})/${1}string | null${2}/' "$OUT"
perl -0ne 'exit(/tier_capability_type:\s*\{\s*Args:\s*\{\s*p_capability_key:\s*string\s*\}\s*Returns:\s*string \| null\s*\}/ ? 0 : 1)' "$OUT" || {
  echo "Expected tier_capability_type to return string | null in $OUT" >&2
  exit 1
}

echo "Wrote $OUT"
