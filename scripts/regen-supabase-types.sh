#!/usr/bin/env bash
# Regenerate src/integrations/supabase/types.ts from the linked Supabase project's public schema.
# Requires network + Supabase CLI (`npx supabase`).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/src/integrations/supabase/types.ts"
GENERATED="$(mktemp)"
PATCHED="$(mktemp)"
trap 'rm -f "$GENERATED" "$PATCHED"' EXIT
npx supabase gen types typescript --project-id schdyxcunwcvddlcshwd --schema public >"$GENERATED"
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
  cat "$GENERATED"
} >"$PATCHED"

# Supabase CLI emits scalar RPC returns as non-nullable, but this SQL function
# intentionally returns NULL for unknown capability keys.
perl -0pi -e 's/(tier_capability_type:\s*\{\s*Args:\s*\{\s*p_capability_key:\s*string\s*\}\s*Returns:\s*)string(\s*\})/${1}string | null${2}/' "$PATCHED"
perl -0ne 'exit(/tier_capability_type:\s*\{\s*Args:\s*\{\s*p_capability_key:\s*string\s*\}\s*Returns:\s*string \| null\s*\}/ ? 0 : 1)' "$PATCHED" || {
  echo "Expected tier_capability_type to return string | null before writing $OUT" >&2
  exit 1
}

mv "$PATCHED" "$OUT"
echo "Wrote $OUT"
