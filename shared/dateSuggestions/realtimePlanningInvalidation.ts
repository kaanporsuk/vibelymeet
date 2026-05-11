export type RealtimePlanningTable =
  | "messages"
  | "date_suggestions"
  | "date_suggestion_revisions"
  | "date_plans"
  | "schedule_share_grants"
  | "schedule_share_grant_slots"
  | "user_schedules"
  | "channel_error";

export type RealtimePlanningScope = {
  matchId: string;
  currentUserId: string;
  participantIds?: readonly string[];
  threadMessagesQueryKey?: readonly unknown[] | null;
};

export type RealtimePlanningEvent = {
  table: RealtimePlanningTable;
  matchId?: string | null;
  userId?: string | null;
  subjectUserId?: string | null;
  scheduleShareRelated?: boolean;
};

export type QueryInvalidationTarget = {
  queryKey: readonly unknown[];
  exact?: boolean;
};

export type QueryInvalidator = {
  invalidateQueries: (target: QueryInvalidationTarget) => unknown;
};

export function invalidateDateScheduleRealtimeEvent(
  queryClient: QueryInvalidator,
  scope: RealtimePlanningScope,
  event: RealtimePlanningEvent,
) {
  const eventMatchId = event.matchId ?? scope.matchId;
  if (eventMatchId !== scope.matchId) return;

  const invalidate = (queryKey: readonly unknown[], exact = true) => {
    void queryClient.invalidateQueries({ queryKey, exact });
  };

  const invalidateDateSuggestions = () => invalidate(["date-suggestions", scope.matchId]);
  const invalidateScheduleHub = () => invalidate(["schedule-hub", scope.currentUserId]);
  const invalidateCurrentUserSchedule = () => invalidate(["user-schedule", scope.currentUserId]);
  const invalidateThreadMessages = () => {
    if (scope.threadMessagesQueryKey) invalidate(scope.threadMessagesQueryKey);
  };
  const invalidateSharedSchedule = (subjectUserId?: string | null) => {
    if (subjectUserId) {
      invalidate(["shared-schedule", scope.matchId, subjectUserId]);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["shared-schedule", scope.matchId] });
  };
  const invalidateCallerGrant = () => {
    void queryClient.invalidateQueries({ queryKey: ["caller-schedule-share-grant", scope.matchId] });
  };
  const invalidateParticipantSharedSchedules = () => {
    const ids = new Set(scope.participantIds ?? []);
    ids.add(scope.currentUserId);
    for (const userId of ids) {
      if (userId) invalidateSharedSchedule(userId);
    }
  };

  switch (event.table) {
    case "messages":
      invalidateThreadMessages();
      invalidateDateSuggestions();
      invalidate(["matches"], false);
      break;
    case "date_suggestions":
      invalidateDateSuggestions();
      invalidateScheduleHub();
      break;
    case "date_suggestion_revisions":
      invalidateDateSuggestions();
      if (event.scheduleShareRelated) invalidateParticipantSharedSchedules();
      break;
    case "schedule_share_grants":
      invalidateSharedSchedule(event.subjectUserId);
      invalidateCallerGrant();
      invalidateDateSuggestions();
      break;
    case "schedule_share_grant_slots":
      invalidateSharedSchedule(event.subjectUserId);
      invalidateDateSuggestions();
      break;
    case "user_schedules":
      if (!event.userId || event.userId === scope.currentUserId) {
        invalidateCurrentUserSchedule();
        invalidateScheduleHub();
      }
      if (!event.userId) {
        invalidateParticipantSharedSchedules();
      } else if (event.userId !== scope.currentUserId) {
        invalidateSharedSchedule(event.userId);
      }
      break;
    case "date_plans":
      invalidateDateSuggestions();
      invalidateScheduleHub();
      invalidateCurrentUserSchedule();
      break;
    case "channel_error":
      invalidateThreadMessages();
      invalidateDateSuggestions();
      invalidateScheduleHub();
      invalidateCurrentUserSchedule();
      invalidateSharedSchedule();
      invalidateCallerGrant();
      break;
  }
}
