#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SQL_HELPER="$REPO_ROOT/scripts/supabase_sql.sh"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

if [ ! -x "$SQL_HELPER" ]; then
  echo "Missing SQL helper at $SQL_HELPER" >&2
  exit 1
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "Missing migrations directory at $MIGRATIONS_DIR" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

LOCAL_VERSIONS_RAW="$TMP_DIR/local_raw.txt"
LOCAL_VERSIONS="$TMP_DIR/local_versions.txt"
REMOTE_VERSIONS_RAW="$TMP_DIR/remote_raw.txt"
REMOTE_VERSIONS="$TMP_DIR/remote_versions.txt"

# Local: extract leading 14-digit timestamp from filenames.
# Example: 20260310124838_foo.sql -> 20260310124838
ls -1 "$MIGRATIONS_DIR"/*.sql 2>/dev/null \
  | sed -E 's#.*/##' \
  | sed -E 's/^([0-9]{14}).*$/\1/' \
  | tee "$LOCAL_VERSIONS_RAW" \
  | grep -E '^[0-9]{14}$' \
  | sort -u > "$LOCAL_VERSIONS"

# Remote: read from Supabase migration history table.
"$SQL_HELPER" -At -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;" \
  | tr -d '\r' \
  | tee "$REMOTE_VERSIONS_RAW" \
  | grep -E '^[0-9]{14}$' \
  | sort -u > "$REMOTE_VERSIONS"

LOCAL_COUNT=$(wc -l < "$LOCAL_VERSIONS" | tr -d ' ')
REMOTE_COUNT=$(wc -l < "$REMOTE_VERSIONS" | tr -d ' ')

REMOTE_MISSING_LOCAL="$TMP_DIR/remote_missing_local.txt"
LOCAL_MISSING_REMOTE="$TMP_DIR/local_missing_remote.txt"

comm -23 "$REMOTE_VERSIONS" "$LOCAL_VERSIONS" > "$REMOTE_MISSING_LOCAL"
comm -13 "$REMOTE_VERSIONS" "$LOCAL_VERSIONS" > "$LOCAL_MISSING_REMOTE"

REMOTE_MISS_COUNT=$(wc -l < "$REMOTE_MISSING_LOCAL" | tr -d ' ')
LOCAL_MISS_COUNT=$(wc -l < "$LOCAL_MISSING_REMOTE" | tr -d ' ')

print_shift_analysis() {
  if [ ! -s "$REMOTE_MISSING_LOCAL" ] && [ ! -s "$LOCAL_MISSING_REMOTE" ]; then
    return 0
  fi

  echo
  echo "## Shift analysis (timestamp drift heuristic)"
  echo "This estimates how much mismatch is explained by systematic +/-1s or +/-2s drift between local filenames and remote versions."

  # Build quick lookup maps in awk for remote/local sets.
  # For each local-missing-remote version v, check if (v-1) or (v-2) exists remotely.
  # For each remote-missing-local version v, check if (v+1) or (v+2) exists locally.
  awk -v rml="$REMOTE_MISSING_LOCAL" -v lmr="$LOCAL_MISSING_REMOTE" '
    BEGIN {
      while ((getline line < rml) > 0) { remoteMissingLocal[line]=1; remoteMissingCount++ }
      close(rml)
      while ((getline line < lmr) > 0) { localMissingRemote[line]=1; localMissingCount++ }
      close(lmr)
    }
    function existsInRemote(v) { return (v in remoteSet) }
    function existsInLocal(v) { return (v in localSet) }
    {
      # no-op; we rely on FNR/NR maps below
    }
  ' </dev/null >/dev/null 2>&1 || true

  # Use two passes to avoid bash associative portability quirks on macOS.
  REMOTE_SET="$TMP_DIR/remote_set.txt"
  LOCAL_SET="$TMP_DIR/local_set.txt"
  cp "$REMOTE_VERSIONS" "$REMOTE_SET"
  cp "$LOCAL_VERSIONS" "$LOCAL_SET"

  local_minus1=$(awk 'NR==FNR { r[$1]=1; next } { v=$1+0; if (r[sprintf("%014d", v-1)]) c++ } END{ print c+0 }' "$REMOTE_SET" "$LOCAL_MISSING_REMOTE")
  local_minus2=$(awk 'NR==FNR { r[$1]=1; next } { v=$1+0; if (r[sprintf("%014d", v-2)]) c++ } END{ print c+0 }' "$REMOTE_SET" "$LOCAL_MISSING_REMOTE")
  remote_plus1=$(awk 'NR==FNR { l[$1]=1; next } { v=$1+0; if (l[sprintf("%014d", v+1)]) c++ } END{ print c+0 }' "$LOCAL_SET" "$REMOTE_MISSING_LOCAL")
  remote_plus2=$(awk 'NR==FNR { l[$1]=1; next } { v=$1+0; if (l[sprintf("%014d", v+2)]) c++ } END{ print c+0 }' "$LOCAL_SET" "$REMOTE_MISSING_LOCAL")

  echo "- Local missing remotely explained by remote having (local-1s): $local_minus1 / $LOCAL_MISS_COUNT"
  echo "- Local missing remotely explained by remote having (local-2s): $local_minus2 / $LOCAL_MISS_COUNT"
  echo "- Remote missing locally explained by local having (remote+1s): $remote_plus1 / $REMOTE_MISS_COUNT"
  echo "- Remote missing locally explained by local having (remote+2s): $remote_plus2 / $REMOTE_MISS_COUNT"
}

print_near_misses() {
  local missing_file="$1"
  local label="$2"

  if [ ! -s "$missing_file" ]; then
    return 0
  fi

  echo
  echo "## Near-miss pairing hints ($label)"
  echo "Heuristic: show the closest local/remote version and flag likely +/- 1-2 second drift."

  # Build an awk script that loads the comparison set (2nd file) into an array,
  # then for each missing version (1st file), finds the closest by absolute numeric difference.
  awk '
    NR==FNR { a[++n]=$1; next }
    function abs(x){ return x<0?-x:x }
    {
      v=$1+0
      best=""; bestd="";
      for (i=1;i<=n;i++) {
        x=a[i]+0
        d=abs(x-v)
        if (best=="" || d<bestd) { best=a[i]; bestd=d }
      }
      hint=""
      if (best!="" && bestd<=2) hint="LIKELY +/-" bestd "s drift"
      else if (best!="" && bestd<=10) hint="nearby (<=10s)"
      printf("- %s -> closest %s (delta=%ss) %s\n", $1, best, bestd, hint)
    }
  ' "$LOCAL_VERSIONS" "$missing_file"
}

print_drift_clusters() {
  local missing_file="$1"
  local title="$2"

  if [ ! -s "$missing_file" ]; then
    return 0
  fi

  echo
  echo "## Drift clusters ($title)"
  echo "Grouped by minute prefix (YYYYMMDDHHMM). Large clusters often indicate history drift rather than one-off missing files."

  awk '{ print substr($1,1,12) }' "$missing_file" \
    | sort \
    | uniq -c \
    | sort -nr \
    | head -n 15 \
    | awk '{ printf("- %s: %s missing\n", $2, $1) }'
}

echo "# Supabase migration parity check"
echo
echo "- Local migration files:   $LOCAL_COUNT"
echo "- Remote applied versions: $REMOTE_COUNT"
echo
echo "## Remote versions missing locally: $REMOTE_MISS_COUNT"
if [ "$REMOTE_MISS_COUNT" -gt 0 ]; then
  head -n 50 "$REMOTE_MISSING_LOCAL" | sed 's/^/- /'
  if [ "$REMOTE_MISS_COUNT" -gt 50 ]; then
    echo "- ... (showing first 50 of $REMOTE_MISS_COUNT)"
  fi
fi

echo
echo "## Local versions missing remotely: $LOCAL_MISS_COUNT"
if [ "$LOCAL_MISS_COUNT" -gt 0 ]; then
  head -n 50 "$LOCAL_MISSING_REMOTE" | sed 's/^/- /'
  if [ "$LOCAL_MISS_COUNT" -gt 50 ]; then
    echo "- ... (showing first 50 of $LOCAL_MISS_COUNT)"
  fi
fi

print_drift_clusters "$REMOTE_MISSING_LOCAL" "remote->local"
print_drift_clusters "$LOCAL_MISSING_REMOTE" "local->remote"
print_shift_analysis

# Near-miss hints are most useful when the counts are small; still provide them, but capped.
if [ "$REMOTE_MISS_COUNT" -gt 0 ] && [ "$REMOTE_MISS_COUNT" -le 30 ]; then
  print_near_misses "$REMOTE_MISSING_LOCAL" "remote missing locally"
fi

if [ "$LOCAL_MISS_COUNT" -gt 0 ] && [ "$LOCAL_MISS_COUNT" -le 30 ]; then
  # For local missing remotely, compare against remote set (swap arrays)
  echo
  echo "## Near-miss pairing hints (local missing remotely)"
  awk '
    NR==FNR { a[++n]=$1; next }
    function abs(x){ return x<0?-x:x }
    {
      v=$1+0
      best=""; bestd="";
      for (i=1;i<=n;i++) {
        x=a[i]+0
        d=abs(x-v)
        if (best=="" || d<bestd) { best=a[i]; bestd=d }
      }
      hint=""
      if (best!="" && bestd<=2) hint="LIKELY +/-" bestd "s drift"
      else if (best!="" && bestd<=10) hint="nearby (<=10s)"
      printf("- %s -> closest %s (delta=%ss) %s\n", $1, best, bestd, hint)
    }
  ' "$REMOTE_VERSIONS" "$LOCAL_MISSING_REMOTE"
fi

echo
if [ "$REMOTE_MISS_COUNT" -eq 0 ] && [ "$LOCAL_MISS_COUNT" -eq 0 ]; then
  echo "✅ Parity OK: remote and local migration versions match."
else
  echo "⚠️  Parity drift detected: do NOT run db push/pull/repair until this is resolved in a dedicated workstream."
  echo "    Next safe step: review the missing sets and decide whether this is (a) naming drift (off-by-seconds) or (b) genuinely missing migrations."
fi
