#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <function-name>" >&2
  exit 1
fi

exec supabase functions deploy "$1" --project-ref schdyxcunwcvddlcshwd --use-api
