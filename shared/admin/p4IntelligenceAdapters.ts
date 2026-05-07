export type P4RawRecord = Record<string, unknown>;

export type P4Window = {
  start: string;
  end: string;
};

export type P4EventLiquidityRow = {
  eventId: string;
  title: string;
  eventDate: string | null;
  rawStatus: string | null;
  archived: boolean;
  market: string | null;
  score: number | null;
  confidence: string | null;
  recommendation: string | null;
  capacity: number | null;
  registrations: number | null;
  confirmed: number | null;
  attendedOrMarked: number | null;
  lobbyParticipants: number | null;
  men: number | null;
  women: number | null;
  otherGender: number | null;
  photoVerified: number | null;
  premium: number | null;
  videoSessions: number | null;
  completedSessions: number | null;
  positiveSwipes: number | null;
  matches: number | null;
  participantReports: number | null;
};

export type P4EntitlementRow = {
  userId: string;
  name: string | null;
  drift: boolean;
  profileIsPremium: boolean | null;
  subscriptionTier: string | null;
  premiumUntil: string | null;
  hasActiveSubscription: boolean;
  hasActiveAdminGrant: boolean;
  entitlementShouldBePremium: boolean;
  subscriptions: unknown[];
};

export type P4TrustTriageRow = {
  userId: string;
  name: string | null;
  riskScore: number | null;
  confidence: string | null;
  recommendedAction: string | null;
  pendingReports: number | null;
  totalReports: number | null;
  blocksReceived: number | null;
  warnings: number | null;
  activeSuspensions: number | null;
  verificationAttempts: number | null;
  possibleNoShows: number | null;
};

export type P4AuthenticityRow = {
  verificationId: string;
  userId: string;
  status: string | null;
  clientConfidenceScore: number | null;
  clientMatchResult: string | null;
  createdAt: string | null;
  expiresAt: string | null;
};

export type P4QualityBudgetRow = {
  budgetKey: string;
  domain: string | null;
  label: string | null;
  targetValue: number | null;
  comparison: string | null;
  unit: string | null;
  latestObservedValue: number | null;
  latestReleaseVersion: string | null;
  latestObservedAt: string | null;
  status: string | null;
};

export type P4StoreChecklistRow = {
  checklistKey: string;
  platform: string | null;
  status: string | null;
  updatedAt: string | null;
};

export type P4StoreReleaseRow = {
  releaseVersion: string;
  platform: string | null;
  channel: string | null;
  status: string | null;
  buildNumber: string | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type P4StoreReviewRow = {
  reviewId: string;
  platform: string | null;
  releaseVersion: string | null;
  rating: number | null;
  sentiment: string | null;
  category: string | null;
  actionStatus: string | null;
  observedAt: string | null;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function asRecord(value: unknown): P4RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as P4RawRecord) : {};
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function coalesce(value: P4RawRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) return value[key];
  }
  return undefined;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function boolOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function bool(value: unknown): boolean {
  return boolOrNull(value) === true;
}

function sortByIsoTime<T extends { eventDate?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const parsedLeft = left.eventDate ? Date.parse(left.eventDate) : Number.NaN;
    const parsedRight = right.eventDate ? Date.parse(right.eventDate) : Number.NaN;
    const leftTime = Number.isFinite(parsedLeft) ? parsedLeft : Number.MAX_SAFE_INTEGER;
    const rightTime = Number.isFinite(parsedRight) ? parsedRight : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });
}

export function createDefaultP4Window(now = new Date()): P4Window {
  const end = new Date(now);
  const start = new Date(end.getTime() - 30 * ONE_DAY_MS);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function isValidP4Window(window: Partial<P4Window> | null | undefined): window is P4Window {
  if (!window?.start || !window.end) return false;
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  return Number.isFinite(start) && Number.isFinite(end) && start < end;
}

export function normalizeEventLiquidityRows(rows: unknown): P4EventLiquidityRow[] {
  return asArray(rows).map((row) => {
    const record = asRecord(row);
    const factors = asRecord(record.factors);
    const eventId = text(coalesce(record, "eventId", "event_id")) ?? "";

    return {
      eventId,
      title: text(coalesce(record, "eventTitle", "event_title", "title", "name")) ?? (eventId || "Untitled event"),
      eventDate: text(coalesce(record, "eventDate", "event_date")),
      rawStatus: text(coalesce(record, "rawStatus", "raw_status", "status")),
      archived: bool(coalesce(record, "archived")),
      market: text(coalesce(record, "market")),
      score: numberValue(coalesce(record, "score")),
      confidence: text(coalesce(record, "confidence")),
      recommendation: text(coalesce(record, "recommendation")),
      capacity: numberValue(coalesce(record, "capacity")) ?? numberValue(coalesce(factors, "capacity")),
      registrations: numberValue(coalesce(record, "registrations")) ?? numberValue(coalesce(factors, "registrations")),
      confirmed: numberValue(coalesce(record, "confirmed")) ?? numberValue(coalesce(factors, "confirmed")),
      attendedOrMarked: numberValue(coalesce(record, "attendedOrMarked", "attended_or_marked")) ?? numberValue(coalesce(factors, "attendedOrMarked", "attended_or_marked")),
      lobbyParticipants: numberValue(coalesce(record, "lobbyParticipants", "lobby_participants")) ?? numberValue(coalesce(factors, "lobbyParticipants", "lobby_participants")),
      men: numberValue(coalesce(record, "men")) ?? numberValue(coalesce(factors, "men")),
      women: numberValue(coalesce(record, "women")) ?? numberValue(coalesce(factors, "women")),
      otherGender: numberValue(coalesce(record, "otherGender", "other_gender")) ?? numberValue(coalesce(factors, "otherGender", "other_gender")),
      photoVerified: numberValue(coalesce(record, "photoVerified", "photo_verified")) ?? numberValue(coalesce(factors, "photoVerified", "photo_verified")),
      premium: numberValue(coalesce(record, "premium")) ?? numberValue(coalesce(factors, "premium")),
      videoSessions: numberValue(coalesce(record, "videoSessions", "video_sessions")) ?? numberValue(coalesce(factors, "videoSessions", "video_sessions")),
      completedSessions: numberValue(coalesce(record, "completedSessions", "completed_sessions")) ?? numberValue(coalesce(factors, "completedSessions", "completed_sessions")),
      positiveSwipes: numberValue(coalesce(record, "positiveSwipes", "positive_swipes")) ?? numberValue(coalesce(factors, "positiveSwipes", "positive_swipes")),
      matches: numberValue(coalesce(record, "matches")) ?? numberValue(coalesce(factors, "matches")),
      participantReports: numberValue(coalesce(record, "participantReports", "participant_reports")) ?? numberValue(coalesce(factors, "participantReports", "participant_reports")),
    };
  });
}

export function splitEventLiquidityRows(rows: P4EventLiquidityRow[]): {
  activeRows: P4EventLiquidityRow[];
  archivedRows: P4EventLiquidityRow[];
} {
  const groups = rows.reduce<{ activeRows: P4EventLiquidityRow[]; archivedRows: P4EventLiquidityRow[] }>(
    (nextGroups, row) => {
      if (row.archived || row.rawStatus?.toLowerCase() === "archived") {
        nextGroups.archivedRows.push(row);
      } else {
        nextGroups.activeRows.push(row);
      }
      return nextGroups;
    },
    { activeRows: [], archivedRows: [] },
  );

  return {
    activeRows: sortByIsoTime(groups.activeRows),
    archivedRows: sortByIsoTime(groups.archivedRows),
  };
}

export function normalizeEntitlementRows(rows: unknown): P4EntitlementRow[] {
  return asArray(rows).map((row) => {
    const record = asRecord(row);
    const hasActiveSubscription = bool(coalesce(record, "hasActiveSubscription", "has_active_subscription"));
    const hasActiveAdminGrant = bool(coalesce(record, "hasActiveAdminGrant", "has_active_admin_grant"));
    const entitlementShouldBePremium =
      boolOrNull(coalesce(record, "entitlementShouldBePremium", "entitlement_should_be_premium")) ??
      (hasActiveSubscription || hasActiveAdminGrant);
    const profileIsPremium = boolOrNull(coalesce(record, "profileIsPremium", "profile_is_premium"));
    const drift = boolOrNull(coalesce(record, "drift")) ?? profileIsPremium !== entitlementShouldBePremium;

    return {
      userId: text(coalesce(record, "userId", "user_id")) ?? "",
      name: text(coalesce(record, "name")),
      drift,
      profileIsPremium,
      subscriptionTier: text(coalesce(record, "subscriptionTier", "subscription_tier")),
      premiumUntil: text(coalesce(record, "premiumUntil", "premium_until")),
      hasActiveSubscription,
      hasActiveAdminGrant,
      entitlementShouldBePremium,
      subscriptions: asArray(coalesce(record, "subscriptions")),
    };
  });
}

export function filterEntitlementDriftRows(rows: P4EntitlementRow[]): P4EntitlementRow[] {
  return rows.filter((row) => row.drift);
}

export function normalizeTrustRows(rows: unknown): P4TrustTriageRow[] {
  return asArray(rows).map((row) => {
    const record = asRecord(row);
    const signals = asRecord(record.signals);

    return {
      userId: text(coalesce(record, "userId", "user_id")) ?? "",
      name: text(coalesce(record, "name")),
      riskScore: numberValue(coalesce(record, "riskScore", "risk_score")),
      confidence: text(coalesce(record, "confidence")),
      recommendedAction: text(coalesce(record, "recommendedAction", "recommended_action")),
      pendingReports: numberValue(coalesce(record, "pendingReports", "pending_reports")) ?? numberValue(coalesce(signals, "pendingReports", "pending_reports")),
      totalReports: numberValue(coalesce(record, "totalReports", "total_reports")) ?? numberValue(coalesce(signals, "totalReports", "total_reports")),
      blocksReceived: numberValue(coalesce(record, "blocksReceived", "blocks_received")) ?? numberValue(coalesce(signals, "blocksReceived", "blocks_received")),
      warnings: numberValue(coalesce(record, "warnings")) ?? numberValue(coalesce(signals, "warnings")),
      activeSuspensions: numberValue(coalesce(record, "activeSuspensions", "active_suspensions")) ?? numberValue(coalesce(signals, "activeSuspensions", "active_suspensions")),
      verificationAttempts: numberValue(coalesce(record, "verificationAttempts", "verification_attempts")) ?? numberValue(coalesce(signals, "verificationAttempts", "verification_attempts")),
      possibleNoShows: numberValue(coalesce(record, "possibleNoShows", "possible_no_shows")) ?? numberValue(coalesce(signals, "possibleNoShows", "possible_no_shows")),
    };
  });
}

export function normalizeAuthenticityRows(rows: unknown): P4AuthenticityRow[] {
  return asArray(rows).map((row) => {
    const record = asRecord(row);

    return {
      verificationId: text(coalesce(record, "verificationId", "verification_id")) ?? "",
      userId: text(coalesce(record, "userId", "user_id")) ?? "",
      status: text(coalesce(record, "status")),
      clientConfidenceScore: numberValue(coalesce(record, "clientConfidenceScore", "client_confidence_score")),
      clientMatchResult: text(coalesce(record, "clientMatchResult", "client_match_result")),
      createdAt: text(coalesce(record, "createdAt", "created_at")),
      expiresAt: text(coalesce(record, "expiresAt", "expires_at")),
    };
  });
}

export function normalizeQualityBudgetRows(rows: unknown): P4QualityBudgetRow[] {
  return asArray(rows).map((row) => {
    const record = asRecord(row);

    return {
      budgetKey: text(coalesce(record, "budgetKey", "budget_key")) ?? "",
      domain: text(coalesce(record, "domain")),
      label: text(coalesce(record, "label")),
      targetValue: numberValue(coalesce(record, "targetValue", "target_value")),
      comparison: text(coalesce(record, "comparison")),
      unit: text(coalesce(record, "unit")),
      latestObservedValue: numberValue(coalesce(record, "latestObservedValue", "latest_observed_value")),
      latestReleaseVersion: text(coalesce(record, "latestReleaseVersion", "latest_release_version")),
      latestObservedAt: text(coalesce(record, "latestObservedAt", "latest_observed_at")),
      status: text(coalesce(record, "status")),
    };
  });
}

export function normalizeStoreChecklistRows(rows: unknown): P4StoreChecklistRow[] {
  return asArray(rows).map((row) => {
    const record = asRecord(row);

    return {
      checklistKey: text(coalesce(record, "checklistKey", "checklist_key")) ?? "",
      platform: text(coalesce(record, "platform")),
      status: text(coalesce(record, "status")),
      updatedAt: text(coalesce(record, "updatedAt", "updated_at")),
    };
  });
}

export function normalizeStoreReleaseRows(rows: unknown): P4StoreReleaseRow[] {
  return asArray(rows).map((row) => {
    const record = asRecord(row);

    return {
      releaseVersion: text(coalesce(record, "releaseVersion", "release_version")) ?? "",
      platform: text(coalesce(record, "platform")),
      channel: text(coalesce(record, "channel")),
      status: text(coalesce(record, "status")),
      buildNumber: text(coalesce(record, "buildNumber", "build_number")),
      createdAt: text(coalesce(record, "createdAt", "created_at")),
      startedAt: text(coalesce(record, "startedAt", "started_at")),
      completedAt: text(coalesce(record, "completedAt", "completed_at")),
    };
  });
}

export function normalizeStoreReviewRows(rows: unknown): P4StoreReviewRow[] {
  return asArray(rows).map((row) => {
    const record = asRecord(row);

    return {
      reviewId: text(coalesce(record, "reviewId", "review_id", "id")) ?? "",
      platform: text(coalesce(record, "platform")),
      releaseVersion: text(coalesce(record, "releaseVersion", "release_version")),
      rating: numberValue(coalesce(record, "rating", "ratingValue", "rating_value")),
      sentiment: text(coalesce(record, "sentiment")),
      category: text(coalesce(record, "category")),
      actionStatus: text(coalesce(record, "actionStatus", "action_status", "status")),
      observedAt: text(coalesce(record, "observedAt", "observed_at")),
    };
  });
}
