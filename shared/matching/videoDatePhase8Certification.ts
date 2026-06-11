export type VideoDatePhase8RunKind =
  | "two_user_e2e"
  | "rls_negative"
  | "chaos"
  | "load"
  | "native_smoke"
  | "rollout_step"
  | "legacy_cleanup";

export type VideoDatePhase8Platform =
  | "web"
  | "native"
  | "mobile"
  | "cross_platform"
  | "backend"
  | "ops";

export type VideoDatePhase8RunStatus =
  | "pending"
  | "passed"
  | "failed"
  | "blocked"
  | "waived";

export type VideoDatePhase8PrSlice = {
  pr: "8.1" | "8.2" | "8.3" | "8.4" | "8.5" | "8.6";
  title: string;
  requiredRunKinds: VideoDatePhase8RunKind[];
  ownerSurface: "web_native_backend" | "backend_ops" | "ops_cleanup" | "web_native_cleanup" | "ops_release";
};

export const VIDEO_DATE_PHASE8_PR_SLICES: readonly VideoDatePhase8PrSlice[] = [
  {
    pr: "8.1",
    title: "Two-user web/native certification harness",
    requiredRunKinds: ["two_user_e2e", "native_smoke"],
    ownerSurface: "web_native_backend",
  },
  {
    pr: "8.2",
    title: "RLS, chaos, and load certification",
    requiredRunKinds: ["rls_negative", "chaos", "load"],
    ownerSurface: "backend_ops",
  },
  {
    pr: "8.3",
    title: "Rollout gates and legacy cleanup readiness",
    requiredRunKinds: ["rollout_step"],
    ownerSurface: "ops_cleanup",
  },
  {
    pr: "8.4",
    title: "Service-role rollout and cleanup proof wrappers",
    requiredRunKinds: ["rollout_step", "legacy_cleanup"],
    ownerSurface: "ops_release",
  },
  {
    pr: "8.5",
    title: "Server-dealt deck final client cutover",
    requiredRunKinds: ["legacy_cleanup"],
    ownerSurface: "web_native_cleanup",
  },
  {
    pr: "8.6",
    title: "Phase 8 release closure gate",
    requiredRunKinds: ["rollout_step", "legacy_cleanup"],
    ownerSurface: "ops_release",
  },
] as const;

export type VideoDatePhase8RolloutStep = {
  targetRolloutBps: 100 | 1000 | 5000 | 10000;
  label: "1%" | "10%" | "50%" | "100%";
  minFirstFrameSamples: number;
  requiresDeckBake: boolean;
  maxFirstFrameP95Ms: number;
  maxFirstFrameP99Ms: number;
};

export const VIDEO_DATE_PHASE8_ROLLOUT_STEPS: readonly VideoDatePhase8RolloutStep[] = [
  {
    targetRolloutBps: 100,
    label: "1%",
    minFirstFrameSamples: 0,
    requiresDeckBake: false,
    maxFirstFrameP95Ms: 5000,
    maxFirstFrameP99Ms: 8000,
  },
  {
    targetRolloutBps: 1000,
    label: "10%",
    minFirstFrameSamples: 20,
    requiresDeckBake: false,
    maxFirstFrameP95Ms: 5000,
    maxFirstFrameP99Ms: 8000,
  },
  {
    targetRolloutBps: 5000,
    label: "50%",
    minFirstFrameSamples: 50,
    requiresDeckBake: false,
    maxFirstFrameP95Ms: 5000,
    maxFirstFrameP99Ms: 8000,
  },
  {
    targetRolloutBps: 10000,
    label: "100%",
    minFirstFrameSamples: 100,
    requiresDeckBake: true,
    maxFirstFrameP95Ms: 5000,
    maxFirstFrameP99Ms: 8000,
  },
] as const;

export type VideoDatePhase8CertificationInput = {
  twoUserWebPassed: boolean;
  twoUserNativePassed: boolean;
  rlsNegativePassed: boolean;
  chaosPassed: boolean;
  loadPassed: boolean;
  recoveryPageAlerts: number;
  recoveryWatchAlerts: number;
  stuckActiveSessionsOver2m: number;
  firstFrameSampleCount: number;
  firstFrameP95Ms: number | null;
  firstFrameP99Ms: number | null;
  dailyProductionConfigReady: boolean;
  dailyWebhookSecretReady: boolean;
  dailyCleanupCronReady: boolean;
  coreFlagsEnabled: boolean;
  coreFlagsKilled: boolean;
  currentRolloutBps: number;
  rollout1PctPassed?: boolean;
  rollout10PctPassed?: boolean;
  rollout50PctPassed?: boolean;
  deckDeal100PctBaked: boolean;
};

export type VideoDatePhase8RolloutDecision = {
  targetRolloutBps: VideoDatePhase8RolloutStep["targetRolloutBps"];
  label: VideoDatePhase8RolloutStep["label"];
  allowed: boolean;
  blockers: string[];
};

function addBlocker(blockers: string[], condition: boolean, blocker: string) {
  if (condition) blockers.push(blocker);
}

export function evaluateVideoDatePhase8RolloutStep(
  input: VideoDatePhase8CertificationInput,
  step: VideoDatePhase8RolloutStep,
): VideoDatePhase8RolloutDecision {
  const blockers: string[] = [];
  addBlocker(blockers, !input.twoUserWebPassed, "two_user_web_not_passed");
  addBlocker(blockers, !input.twoUserNativePassed, "two_user_native_not_passed");
  addBlocker(blockers, !input.rlsNegativePassed, "rls_negative_not_passed");
  addBlocker(blockers, !input.chaosPassed, "chaos_not_passed");
  addBlocker(blockers, !input.loadPassed, "load_not_passed");
  addBlocker(blockers, !input.coreFlagsEnabled, "core_flags_not_enabled");
  addBlocker(blockers, input.coreFlagsKilled, "core_flag_kill_switch_active");
  addBlocker(blockers, !input.dailyProductionConfigReady, "daily_production_config_not_ready");
  addBlocker(blockers, !input.dailyWebhookSecretReady, "daily_webhook_secret_not_ready");
  addBlocker(blockers, !input.dailyCleanupCronReady, "daily_cleanup_cron_not_ready");
  addBlocker(blockers, input.recoveryPageAlerts > 0, "recovery_page_alerts_active");
  addBlocker(blockers, input.stuckActiveSessionsOver2m > 0, "stuck_active_sessions_over_2m");
  addBlocker(
    blockers,
    step.targetRolloutBps >= 1000 && !input.rollout1PctPassed,
    "rollout_1pct_not_certified",
  );
  addBlocker(
    blockers,
    step.targetRolloutBps >= 1000 && input.currentRolloutBps < 100,
    "current_rollout_bps_below_1pct",
  );
  addBlocker(
    blockers,
    step.targetRolloutBps >= 5000 && !input.rollout10PctPassed,
    "rollout_10pct_not_certified",
  );
  addBlocker(
    blockers,
    step.targetRolloutBps >= 5000 && input.currentRolloutBps < 1000,
    "current_rollout_bps_below_10pct",
  );
  addBlocker(
    blockers,
    step.targetRolloutBps >= 10000 && !input.rollout50PctPassed,
    "rollout_50pct_not_certified",
  );
  addBlocker(
    blockers,
    step.targetRolloutBps >= 10000 && input.currentRolloutBps < 5000,
    "current_rollout_bps_below_50pct",
  );

  if (step.minFirstFrameSamples > 0) {
    addBlocker(
      blockers,
      input.firstFrameSampleCount < step.minFirstFrameSamples,
      "insufficient_first_frame_samples",
    );
    addBlocker(
      blockers,
      input.firstFrameP95Ms === null || input.firstFrameP95Ms > step.maxFirstFrameP95Ms,
      "first_frame_p95_over_target",
    );
    addBlocker(
      blockers,
      input.firstFrameP99Ms === null || input.firstFrameP99Ms > step.maxFirstFrameP99Ms,
      "first_frame_p99_over_target",
    );
  }

  addBlocker(
    blockers,
    step.requiresDeckBake && !input.deckDeal100PctBaked,
    "deck_deal_100pct_not_baked",
  );

  return {
    targetRolloutBps: step.targetRolloutBps,
    label: step.label,
    allowed: blockers.length === 0,
    blockers,
  };
}

export function evaluateVideoDatePhase8Rollout(
  input: VideoDatePhase8CertificationInput,
): VideoDatePhase8RolloutDecision[] {
  return VIDEO_DATE_PHASE8_ROLLOUT_STEPS.map((step) =>
    evaluateVideoDatePhase8RolloutStep(input, step),
  );
}

export function nextVideoDatePhase8RolloutStep(
  input: VideoDatePhase8CertificationInput,
): VideoDatePhase8RolloutDecision | null {
  return evaluateVideoDatePhase8Rollout(input).find(
    (decision) => decision.targetRolloutBps > input.currentRolloutBps && decision.allowed,
  ) ?? null;
}

export function isVideoDateLegacyDeckCleanupAllowed(
  input: Pick<
    VideoDatePhase8CertificationInput,
    | "deckDeal100PctBaked"
    | "currentRolloutBps"
    | "coreFlagsEnabled"
    | "coreFlagsKilled"
    | "dailyCleanupCronReady"
    | "recoveryPageAlerts"
    | "stuckActiveSessionsOver2m"
  >,
): boolean {
  return (
    input.deckDeal100PctBaked &&
    input.currentRolloutBps >= 10000 &&
    input.coreFlagsEnabled &&
    !input.coreFlagsKilled &&
    input.dailyCleanupCronReady &&
    input.recoveryPageAlerts === 0 &&
    input.stuckActiveSessionsOver2m === 0
  );
}

export type VideoDatePhase8ReleaseClosureInput = Pick<
  VideoDatePhase8CertificationInput,
  | "coreFlagsEnabled"
  | "coreFlagsKilled"
  | "dailyProductionConfigReady"
  | "dailyWebhookSecretReady"
  | "dailyCleanupCronReady"
  | "currentRolloutBps"
  | "deckDeal100PctBaked"
  | "recoveryPageAlerts"
  | "stuckActiveSessionsOver2m"
> & {
  rollout1PctPassed: boolean;
  rollout10PctPassed: boolean;
  rollout50PctPassed: boolean;
  rollout100PctPassed: boolean;
  legacyCleanupPassed: boolean;
};

export function getVideoDatePhase8ReleaseClosureBlockers(
  input: VideoDatePhase8ReleaseClosureInput,
): string[] {
  const blockers: string[] = [];
  addBlocker(blockers, !input.coreFlagsEnabled, "core_flags_not_enabled");
  addBlocker(blockers, input.coreFlagsKilled, "core_flag_kill_switch_active");
  addBlocker(blockers, !input.dailyProductionConfigReady, "daily_production_config_not_ready");
  addBlocker(blockers, !input.dailyWebhookSecretReady, "daily_webhook_secret_not_ready");
  addBlocker(blockers, !input.dailyCleanupCronReady, "daily_cleanup_cron_not_ready");
  addBlocker(blockers, input.currentRolloutBps < 10000, "current_rollout_bps_below_100pct");
  addBlocker(blockers, !input.rollout1PctPassed, "rollout_1pct_not_certified");
  addBlocker(blockers, !input.rollout10PctPassed, "rollout_10pct_not_certified");
  addBlocker(blockers, !input.rollout50PctPassed, "rollout_50pct_not_certified");
  addBlocker(blockers, !input.rollout100PctPassed, "rollout_100pct_not_certified");
  addBlocker(blockers, !input.deckDeal100PctBaked, "deck_deal_100pct_not_baked");
  addBlocker(blockers, !input.legacyCleanupPassed, "legacy_cleanup_not_certified");
  addBlocker(blockers, input.recoveryPageAlerts > 0, "recovery_page_alerts_active");
  addBlocker(blockers, input.stuckActiveSessionsOver2m > 0, "stuck_active_sessions_over_2m");
  return blockers;
}

export function isVideoDatePhase8ReleaseClosed(
  input: VideoDatePhase8ReleaseClosureInput,
): boolean {
  return getVideoDatePhase8ReleaseClosureBlockers(input).length === 0;
}
