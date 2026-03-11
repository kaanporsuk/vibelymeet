export const ReadyGateQueueStatus = {
  Idle: "idle",
  Browsing: "browsing",
  Searching: "searching",
  Matched: "matched",
  InReadyGate: "in_ready_gate",
  InHandshake: "in_handshake",
  InDate: "in_date",
  InSurvey: "in_survey",
  Completed: "completed",
  Offline: "offline",
} as const;
export type ReadyGateQueueStatus =
  (typeof ReadyGateQueueStatus)[keyof typeof ReadyGateQueueStatus];

export const ReadyGateStatus = {
  Queued: "queued",
  Ready: "ready",
  ReadyA: "ready_a",
  ReadyB: "ready_b",
  BothReady: "both_ready",
  Forfeited: "forfeited",
  Snoozed: "snoozed",
  Expired: "expired",
} as const;
export type ReadyGateStatus =
  (typeof ReadyGateStatus)[keyof typeof ReadyGateStatus];

export const VideoSessionState = {
  Pending: "pending",
  Active: "active",
  Ended: "ended",
} as const;
export type VideoSessionState =
  (typeof VideoSessionState)[keyof typeof VideoSessionState];

export const DailyDropState = {
  Pending: "pending",
  Sent: "sent",
  Viewed: "viewed",
  Expired: "expired",
} as const;
export type DailyDropState =
  (typeof DailyDropState)[keyof typeof DailyDropState];

export const BunnyAssetStatus = {
  Uploading: "uploading",
  Processing: "processing",
  Ready: "ready",
  Failed: "failed",
} as const;
export type BunnyAssetStatus =
  (typeof BunnyAssetStatus)[keyof typeof BunnyAssetStatus];

export const EventState = {
  Draft: "draft",
  Scheduled: "scheduled",
  Live: "live",
  Completed: "completed",
  Cancelled: "cancelled",
} as const;
export type EventState = (typeof EventState)[keyof typeof EventState];

export const MatchStatus = {
  Pending: "pending",
  Active: "active",
  Queued: "match_queued",
  Completed: "completed",
  Unmatched: "unmatched",
} as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];

export const SwipeOutcome = {
  Like: "like",
  Dislike: "dislike",
  SuperLike: "super_like",
  Skip: "skip",
} as const;
export type SwipeOutcome = (typeof SwipeOutcome)[keyof typeof SwipeOutcome];

export const SubscriptionState = {
  None: "none",
  Trialing: "trialing",
  Active: "active",
  PastDue: "past_due",
  Canceled: "canceled",
} as const;
export type SubscriptionState =
  (typeof SubscriptionState)[keyof typeof SubscriptionState];

export const NotificationCategory = {
  NewMatch: "new_match",
  Message: "message",
  SomeoneVibedYou: "someone_vibed_you",
  ReadyGate: "ready_gate",
  EventLive: "event_live",
  EventReminder: "event_reminder",
  DateReminder: "date_reminder",
  DailyDrop: "daily_drop",
  Recommendations: "recommendations",
  ProductUpdates: "product_updates",
  CreditsSubscription: "credits_subscription",
} as const;
export type NotificationCategory =
  (typeof NotificationCategory)[keyof typeof NotificationCategory];

