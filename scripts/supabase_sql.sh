#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$REPO_ROOT/.env.cursor.local" ]; then
  set -a
  source "$REPO_ROOT/.env.cursor.local"
  set +a
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL is required. Set it in .env.cursor.local or the environment." >&2
  exit 1
fi

exec psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 "$@"
