#!/usr/bin/env bash
# Event Lobby, provider, and Video Date hardening contract pack.
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
run_step npx tsx shared/matching/eventLobbySwipeAuthContract.test.ts
run_step npx tsx shared/matching/readyGateTransitionExpiryRowcount.test.ts
run_step npx tsx shared/matching/readyGateEventEndedTerminalization.test.ts
run_step npx tsx shared/matching/readyGateContractConsumerCompliance.test.ts
run_step npx tsx shared/matching/readyGateTerminalUxObservability.test.ts
run_step npx tsx shared/matching/nativeReadyGateParityContract.test.ts
run_step npx tsx shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts
run_step npx tsx shared/matching/webEventLobbyGating.test.ts
run_step npx tsx shared/matching/eventLobbyReadyQueueContract.test.ts
run_step npx tsx shared/matching/staleReadyGateRoomBlockerRepair.test.ts
run_step npx tsx shared/matching/dbLintErrorCleanup.test.ts
run_step npx tsx shared/matching/eventLobbyDeckPayloadMedia.test.ts
run_step npx tsx shared/observability/eventLobbyObservability.test.ts
run_step npx tsx shared/matching/realtimeSubscriptionTightening.test.ts
run_step npx tsx shared/matching/premiumCreditsObservability.test.ts
run_step npx tsx shared/matching/nativeVideoDateContractRecovery.test.ts
run_step npx tsx shared/matching/onesignalProviderOperationalQa.test.ts
run_step npx tsx shared/matching/dailyProviderOperationalQa.test.ts
run_step npx tsx shared/matching/nativeVideoDateLogFollowup.test.ts
run_step npx tsx shared/observability/videoDateOperatorMetrics.test.ts
run_step npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts
run_step npx tsx --test shared/matching/videoDateEndToEndHardening.test.ts
run_step node scripts/audit-video-date-remote-frame.mjs
run_step git diff --check

echo
echo "Hardening contract pack passed."
