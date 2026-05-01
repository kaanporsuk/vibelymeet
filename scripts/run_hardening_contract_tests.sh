#!/usr/bin/env bash
# Streams 1-11 hardening contract pack.
# Source/static tests only; this script does not deploy or mutate Supabase.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

run_step() {
  echo
  echo "==> $*"
  "$@"
}

run_step npx tsx shared/matching/eventLobbyActiveEventContract.test.ts
run_step npx tsx shared/matching/eventLobbyCanonicalActiveState.test.ts
run_step npx tsx shared/matching/readyGateTransitionExpiryRowcount.test.ts
run_step npx tsx shared/matching/readyGateEventEndedTerminalization.test.ts
run_step npx tsx shared/matching/readyGateContractConsumerCompliance.test.ts
run_step npx tsx shared/matching/readyGateTerminalUxObservability.test.ts
run_step npx tsx shared/matching/nativeReadyGateParityContract.test.ts
run_step npx tsx shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts
run_step npx tsx shared/matching/webEventLobbyGating.test.ts
run_step npx tsx shared/matching/eventLobbyReadyQueueContract.test.ts
run_step npx tsx shared/matching/realtimeSubscriptionTightening.test.ts
run_step npx tsx shared/matching/premiumCreditsObservability.test.ts
run_step npx tsx shared/matching/nativeVideoDateContractRecovery.test.ts
run_step npx tsx shared/matching/onesignalProviderOperationalQa.test.ts
run_step npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts
run_step npx tsx --test shared/matching/videoDateEndToEndHardening.test.ts
run_step git diff --check

echo
echo "Hardening contract pack passed."
