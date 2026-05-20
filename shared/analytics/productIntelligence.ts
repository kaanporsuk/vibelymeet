export const ProductIntelligenceEvents = {
  activation: {
    SIGNUP_STARTED: "activation.signup_started",
    SIGNUP_COMPLETED: "activation.signup_completed",
    ONBOARDING_STEP_VIEWED: "activation.onboarding_step_viewed",
    ONBOARDING_COMPLETED: "activation.onboarding_completed",
    PROFILE_MEDIA_ADDED: "activation.profile_media_added",
  },
  events: {
    EVENT_VIEWED: "events.event_viewed",
    EVENT_REGISTERED: "events.event_registered",
    EVENT_WAITLISTED: "events.event_waitlisted",
    LOBBY_ENTERED: "events.lobby_entered",
    VIDEO_DATE_STARTED: "events.video_date_started",
    POST_DATE_FEEDBACK_SUBMITTED: "events.post_date_feedback_submitted",
  },
  matching: {
    DECK_IMPRESSION: "matching.deck_impression",
    SWIPE_SUBMITTED: "matching.swipe_submitted",
    MUTUAL_MATCH_CREATED: "matching.mutual_match_created",
    SECOND_MESSAGE_SENT: "matching.second_message_sent",
    MATCH_QUALITY_SIGNAL: "matching.quality_signal",
  },
  trust: {
    REPORT_SUBMITTED: "trust.report_submitted",
    BLOCK_CREATED: "trust.block_created",
    VERIFICATION_SUBMITTED: "trust.verification_submitted",
    VERIFICATION_DECIDED: "trust.verification_decided",
    TRIAGE_RECOMMENDATION_SHOWN: "trust.triage_recommendation_shown",
  },
  revenue: {
    PREMIUM_ENTRY_TAPPED: "revenue.premium_entry_tapped",
    CHECKOUT_STARTED: "revenue.checkout_started",
    PURCHASE_COMPLETED: "revenue.purchase_completed",
    PURCHASE_FAILED: "revenue.purchase_failed",
    ENTITLEMENT_RECONCILED: "revenue.entitlement_reconciled",
  },
  growth: {
    INVITE_LINK_VIEWED: "growth.invite_link_viewed",
    INVITE_LINK_COPIED: "growth.invite_link_copied",
    INVITE_LINK_SHARED: "growth.invite_link_shared",
    REFERRAL_CLAIMED: "growth.referral_claimed",
    REFERRAL_QUALITY_SCORED: "growth.referral_quality_scored",
  },
  nativeStore: {
    RELEASE_SMOKE_STARTED: "native_store.release_smoke_started",
    RELEASE_SMOKE_COMPLETED: "native_store.release_smoke_completed",
    DEEP_LINK_TESTED: "native_store.deep_link_tested",
    PUSH_TOKEN_SYNCED: "native_store.push_token_synced",
  },
  cost: {
    PROVIDER_USAGE_OBSERVED: "cost.provider_usage_observed",
    UNIT_ECONOMICS_OBSERVED: "cost.unit_economics_observed",
  },
  quality: {
    QUALITY_BUDGET_OBSERVED: "quality.budget_observed",
    APP_STARTUP_OBSERVED: "quality.app_startup_observed",
    VIDEO_DATE_JOIN_LATENCY_OBSERVED: "quality.video_date_join_latency_observed",
  },
  experiments: {
    ASSIGNED: "experiments.assigned",
    EXPOSURE_RECORDED: "experiments.exposure_recorded",
    SAFETY_STOP_TRIGGERED: "experiments.safety_stop_triggered",
  },
} as const;

export type ProductIntelligencePlatform = "web" | "native" | "backend" | "edge";
export type ProductIntelligencePrimitive = string | number | boolean;
export type ProductIntelligenceProperties = Record<string, ProductIntelligencePrimitive>;

const blockedKeyFragments = [
  "email",
  "phone",
  "name",
  "username",
  "full_name",
  "first_name",
  "last_name",
  "message",
  "body",
  "content",
  "details",
  "description",
  "bio",
  "about",
  "prompt",
  "photo",
  "avatar",
  "image",
  "selfie",
  "url",
  "token",
  "secret",
  "password",
  "authorization",
  "ip",
  "address",
  "lat",
  "lng",
  "longitude",
  "latitude",
];

const safeStringKeys = new Set([
  "$current_url",
  "$screen_name",
  "action",
  "background_upload_decided_at",
  "background_upload_policy_phase",
  "background_upload_review_after",
  "background_upload_source_of_truth",
  "bucket",
  "campaign_id",
  "category",
  "channel",
  "checkpoint",
  "city",
  "client_request_id",
  "client_health_status",
  "code",
  "country",
  "device_class",
  "domain",
  "entry_state",
  "error_code",
  "event_id",
  "event_type",
  "experiment_key",
  "failure_class",
  "failure_reason",
  "family",
  "from_status",
  "guard",
  "latency_bucket",
  "lifecycle",
  "match_id",
  "method",
  "notification_permission",
  "onesignal_status",
  "outcome",
  "pack",
  "pack_id",
  "payment_status",
  "permission_state",
  "phase",
  "plan",
  "platform",
  "product_id",
  "provider",
  "provider_status",
  "queue_status",
  "reason",
  "reason_code",
  "ready_gate_status",
  "recovery_outcome",
  "release_version",
  "result",
  "resume_strategy",
  "route",
  "segment",
  "session_id",
  "server_status",
  "source",
  "source_action",
  "source_surface",
  "sdk_status",
  "state",
  "status",
  "step_name",
  "subscription_tier",
  "surface",
  "swipe_type",
  "sync_result_code",
  "to_status",
  "transition",
  "trigger",
  "variant_key",
]);

const safeKeyPattern = /^\$?[a-zA-Z0-9_.:-]{1,64}$/;
const safeTokenPattern = /^[a-zA-Z0-9_.:/-]{1,128}$/;

function isBlockedKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (safeStringKeys.has(key)) return false;
  return blockedKeyFragments.some((fragment) => lower.includes(fragment));
}

function safeUrlPath(value: string): string | null {
  try {
    const url = new URL(value, "https://vibely.local");
    return url.pathname.slice(0, 128) || "/";
  } catch {
    return null;
  }
}

function sanitizeString(key: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (key === "$current_url" || key === "route") {
    return safeUrlPath(trimmed);
  }

  if (!safeStringKeys.has(key)) return null;
  if (!safeTokenPattern.test(trimmed)) return null;
  return trimmed.slice(0, 128);
}

export function sanitizeProductIntelligenceProperties(
  properties?: Record<string, unknown> | null,
  options: { platform?: ProductIntelligencePlatform } = {},
): ProductIntelligenceProperties | undefined {
  const clean: ProductIntelligenceProperties = {};

  if (options.platform) clean.platform = options.platform;

  for (const [key, value] of Object.entries(properties || {})) {
    if (!safeKeyPattern.test(key) || isBlockedKey(key)) continue;
    if (value === null || value === undefined) continue;

    if (typeof value === "boolean") {
      clean[key] = value;
      continue;
    }

    if (typeof value === "number") {
      if (Number.isFinite(value)) clean[key] = Number(value.toFixed(3));
      continue;
    }

    if (typeof value === "string") {
      const sanitized = sanitizeString(key, value);
      if (sanitized) clean[key] = sanitized;
    }
  }

  return Object.keys(clean).length > 0 ? clean : undefined;
}
