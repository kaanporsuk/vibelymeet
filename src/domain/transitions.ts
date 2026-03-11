import { ReadyGateQueueStatus, MatchStatus, SubscriptionState } from "./enums";

export const ReadyGateQueueTransitions: Record<
  ReadyGateQueueStatus,
  ReadyGateQueueStatus[]
> = {
  [ReadyGateQueueStatus.Idle]: [
    ReadyGateQueueStatus.Browsing,
    ReadyGateQueueStatus.Searching,
  ],
  [ReadyGateQueueStatus.Browsing]: [
    ReadyGateQueueStatus.Searching,
    ReadyGateQueueStatus.Offline,
  ],
  [ReadyGateQueueStatus.Searching]: [
    ReadyGateQueueStatus.Matched,
    ReadyGateQueueStatus.Browsing,
  ],
  [ReadyGateQueueStatus.Matched]: [
    ReadyGateQueueStatus.InReadyGate,
    ReadyGateQueueStatus.Browsing,
  ],
  [ReadyGateQueueStatus.InReadyGate]: [
    ReadyGateQueueStatus.InHandshake,
    ReadyGateQueueStatus.Browsing,
  ],
  [ReadyGateQueueStatus.InHandshake]: [
    ReadyGateQueueStatus.InDate,
    ReadyGateQueueStatus.Browsing,
  ],
  [ReadyGateQueueStatus.InDate]: [
    ReadyGateQueueStatus.InSurvey,
    ReadyGateQueueStatus.Completed,
  ],
  [ReadyGateQueueStatus.InSurvey]: [
    ReadyGateQueueStatus.Completed,
    ReadyGateQueueStatus.Browsing,
  ],
  [ReadyGateQueueStatus.Completed]: [
    ReadyGateQueueStatus.Browsing,
    ReadyGateQueueStatus.Offline,
  ],
  [ReadyGateQueueStatus.Offline]: [
    ReadyGateQueueStatus.Idle,
    ReadyGateQueueStatus.Browsing,
  ],
};

export const MatchStatusTransitions: Record<MatchStatus, MatchStatus[]> = {
  [MatchStatus.Pending]: [MatchStatus.Active, MatchStatus.Queued],
  [MatchStatus.Active]: [MatchStatus.Completed, MatchStatus.Unmatched],
  [MatchStatus.Queued]: [MatchStatus.Active, MatchStatus.Unmatched],
  [MatchStatus.Completed]: [],
  [MatchStatus.Unmatched]: [],
};

export const SubscriptionTransitions: Record<
  SubscriptionState,
  SubscriptionState[]
> = {
  [SubscriptionState.None]: [SubscriptionState.Trialing, SubscriptionState.Active],
  [SubscriptionState.Trialing]: [
    SubscriptionState.Active,
    SubscriptionState.Canceled,
  ],
  [SubscriptionState.Active]: [
    SubscriptionState.PastDue,
    SubscriptionState.Canceled,
  ],
  [SubscriptionState.PastDue]: [
    SubscriptionState.Active,
    SubscriptionState.Canceled,
  ],
  [SubscriptionState.Canceled]: [],
};

