#!/usr/bin/env bash
# Event Lobby regression harness.
# Source/static tests by default; optional linked Supabase dry-run only.
set -euo pipefail

PRODUCTION_SUPABASE_REF="schdyxcunwcvddlcshwd"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/run_event_lobby_regression.sh [--full] [--db-dry-run] [--staging-smoke-check] [--allow-production]

Options:
  --full                 Also run the full hardening contract pack.
  --db-dry-run           Also run `supabase db push --linked --dry-run` after verifying the linked ref.
  --staging-smoke-check  Validate that manual staging smoke environment metadata is present.
  --allow-production     Permit the staging-smoke metadata check to name the production ref only when an explicit safe fixture is present.
  --help                 Show this help.

Safe defaults:
  - This script does not deploy anything.
  - This script does not execute live RPC smoke flows.
  - Manual staging flows belong in docs/golden-path-event-lobby-regression-runbook.md.

Optional staging-smoke metadata:
  EVENT_LOBBY_REGRESSION_ENV=staging
  EVENT_LOBBY_REGRESSION_SUPABASE_REF=<non-production-ref>
  EVENT_LOBBY_REGRESSION_SAFE_FIXTURES=1
  EVENT_LOBBY_REGRESSION_EVENT_ID=<fixture-event-id>

Production safety:
  The production ref is schdyxcunwcvddlcshwd. A manual smoke that names that ref is refused unless
  --allow-production and EVENT_LOBBY_REGRESSION_PRODUCTION_FIXTURE_ID are both present.
USAGE
}

RUN_FULL=0
RUN_DB_DRY_RUN=0
RUN_STAGING_SMOKE_CHECK=0
ALLOW_PRODUCTION=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)
      RUN_FULL=1
      ;;
    --db-dry-run)
      RUN_DB_DRY_RUN=1
      ;;
    --staging-smoke-check)
      RUN_STAGING_SMOKE_CHECK=1
      ;;
    --allow-production)
      ALLOW_PRODUCTION=1
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

trap 'echo "Event Lobby regression harness failed." >&2' ERR

run_step() {
  echo
  echo "==> $*"
  "$@"
}

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing required Event Lobby regression file: $path" >&2
    exit 1
  fi
}

confirm_linked_supabase_ref() {
  require_file "supabase/.temp/project-ref"
  local linked_ref
  linked_ref="$(tr -d '[:space:]' < supabase/.temp/project-ref)"
  if [[ "$linked_ref" != "$PRODUCTION_SUPABASE_REF" ]]; then
    echo "Linked Supabase ref mismatch. Expected ${PRODUCTION_SUPABASE_REF}, got ${linked_ref:-<empty>}." >&2
    exit 1
  fi
  echo "Linked Supabase ref verified: ${linked_ref}"
}

validate_staging_smoke_metadata() {
  local env_name="${EVENT_LOBBY_REGRESSION_ENV:-}"
  local smoke_ref="${EVENT_LOBBY_REGRESSION_SUPABASE_REF:-}"
  local safe_fixtures="${EVENT_LOBBY_REGRESSION_SAFE_FIXTURES:-}"
  local event_id="${EVENT_LOBBY_REGRESSION_EVENT_ID:-}"
  local production_fixture="${EVENT_LOBBY_REGRESSION_PRODUCTION_FIXTURE_ID:-}"

  if [[ -z "$env_name" || -z "$smoke_ref" || "$safe_fixtures" != "1" || -z "$event_id" ]]; then
    cat >&2 <<'ERROR'
Missing safe staging-smoke metadata. Required:
  EVENT_LOBBY_REGRESSION_ENV=staging
  EVENT_LOBBY_REGRESSION_SUPABASE_REF=<non-production-ref>
  EVENT_LOBBY_REGRESSION_SAFE_FIXTURES=1
  EVENT_LOBBY_REGRESSION_EVENT_ID=<fixture-event-id>
ERROR
    exit 1
  fi

  if [[ "$env_name" == "production" || "$smoke_ref" == "$PRODUCTION_SUPABASE_REF" ]]; then
    if [[ "$ALLOW_PRODUCTION" != "1" || -z "$production_fixture" ]]; then
      cat >&2 <<ERROR
Refusing production smoke metadata for ${PRODUCTION_SUPABASE_REF}.
Only proceed with --allow-production plus EVENT_LOBBY_REGRESSION_PRODUCTION_FIXTURE_ID after an explicit safe fixture is approved.
ERROR
      exit 1
    fi
  fi

  echo "Staging-smoke metadata check passed for env=${env_name}, ref=${smoke_ref}."
  echo "No live RPC smoke flow was executed by this script."
}

echo "=== Event Lobby regression harness ==="

require_file "docs/golden-path-event-lobby-regression-runbook.md"
require_file "scripts/runtime-copy-entities.test.ts"
require_file "shared/eventLifecycle.test.ts"
require_file "shared/matching/eventLobbyRegressionHarness.test.ts"
require_file "shared/matching/eventLobbyActiveEventContract.test.ts"
require_file "shared/matching/eventLobbyCanonicalActiveState.test.ts"
require_file "shared/matching/eventLobbySwipeAuthContract.test.ts"
require_file "shared/matching/eventLobbyDeckAuditClosure.test.ts"
require_file "shared/matching/eventRegistrationRlsAuthority.test.ts"
require_file "shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts"
require_file "shared/matching/webEventLobbyGating.test.ts"
require_file "shared/matching/eventLobbyReadyQueueContract.test.ts"
require_file "shared/matching/eventLobbyDeckPayloadMedia.test.ts"
require_file "shared/matching/videoDateDeckPrefetch.test.ts"
require_file "shared/matching/nativeEventLobbyContractParity.test.ts"
require_file "shared/observability/eventLobbyObservability.test.ts"
require_file "supabase/functions/_shared/matching/videoSessionFlow.test.ts"

if [[ "$RUN_STAGING_SMOKE_CHECK" == "1" ]]; then
  validate_staging_smoke_metadata
fi

run_step npx tsx scripts/runtime-copy-entities.test.ts
run_step npx tsx shared/eventLifecycle.test.ts
run_step npx tsx shared/matching/eventLobbyRegressionHarness.test.ts
run_step npx tsx shared/matching/eventLobbyActiveEventContract.test.ts
run_step npx tsx shared/matching/eventLobbyCanonicalActiveState.test.ts
run_step npx tsx shared/matching/eventLobbySwipeAuthContract.test.ts
run_step npx tsx shared/matching/eventLobbyDeckAuditClosure.test.ts
run_step npx tsx shared/matching/eventRegistrationRlsAuthority.test.ts
run_step npx tsx shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts
run_step npx tsx shared/matching/webEventLobbyGating.test.ts
run_step npx tsx shared/matching/eventLobbyReadyQueueContract.test.ts
run_step npx tsx shared/matching/eventLobbyDeckPayloadMedia.test.ts
run_step npx tsx shared/matching/videoDateDeckPrefetch.test.ts
run_step npx tsx shared/matching/nativeEventLobbyContractParity.test.ts
run_step npx tsx shared/observability/eventLobbyObservability.test.ts
run_step npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts
run_step git diff --check

if [[ "$RUN_FULL" == "1" ]]; then
  run_step npm run test:hardening-contracts
fi

if [[ "$RUN_DB_DRY_RUN" == "1" ]]; then
  confirm_linked_supabase_ref
  run_step supabase db push --linked --dry-run
fi

echo
echo "=== Event Lobby regression harness passed. ==="
echo "Manual staging flow checklist: docs/golden-path-event-lobby-regression-runbook.md"
