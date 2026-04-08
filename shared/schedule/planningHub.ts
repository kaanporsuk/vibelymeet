export type ScheduleHubRevision = {
  id: string;
  date_suggestion_id: string;
  proposed_by: string;
  date_type_key: string;
  time_choice_key: string;
  place_mode_key: string;
  venue_text: string | null;
  optional_message: string | null;
  schedule_share_enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  time_block: string | null;
  created_at: string;
};

export type ScheduleHubPlan = {
  id: string;
  starts_at: string | null;
  ends_at: string | null;
  venue_label: string | null;
  date_type_key: string | null;
  status: string;
  completion_initiated_by: string | null;
  completion_confirmed_at: string | null;
};

export type ScheduleHubSuggestionRecord = {
  id: string;
  match_id: string;
  proposer_id: string;
  recipient_id: string;
  status: string;
  current_revision_id: string | null;
  expires_at: string | null;
  schedule_share_expires_at: string | null;
  created_at: string;
  updated_at: string;
  revisions: ScheduleHubRevision[];
  date_plan: ScheduleHubPlan | null;
  partner_name: string;
  partner_user_id: string;
  partner_avatar?: string | null;
};

export type ScheduleHubBucket = "pending" | "upcoming" | "history";

export type ScheduleHubItem = {
  id: string;
  matchId: string;
  suggestionId: string;
  datePlanId: string | null;
  status: string;
  bucket: ScheduleHubBucket;
  partnerName: string;
  partnerUserId: string;
  partnerAvatar?: string | null;
  isProposer: boolean;
  isIncoming: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  dateTypeKey: string;
  timeChoiceKey: string;
  placeModeKey: string;
  venueText: string | null;
  optionalMessage: string | null;
  timeBlock: string | null;
  scheduleShareEnabled: boolean;
  scheduleShareExpiresAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  canAccept: boolean;
  canDecline: boolean;
  canCancel: boolean;
};

export type ScheduleReminderSource = {
  id: string;
  date: Date;
  mode: "video" | "in-person";
  status: "accepted";
  senderName?: string;
  senderAvatar?: string;
  matchId?: string;
  partnerUserId?: string;
};

const OPEN_STATUSES = new Set(["draft", "proposed", "viewed", "countered"]);
const TERMINAL_STATUSES = new Set(["declined", "not_now", "expired", "cancelled", "completed"]);

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getCurrentScheduleHubRevision(
  record: ScheduleHubSuggestionRecord,
): ScheduleHubRevision | null {
  if (record.revisions.length === 0) return null;
  if (record.current_revision_id) {
    const current = record.revisions.find((revision) => revision.id === record.current_revision_id);
    if (current) return current;
  }
  return record.revisions[record.revisions.length - 1] ?? null;
}

function deriveMode(dateTypeKey: string): "video" | "in-person" {
  return dateTypeKey === "video_date" ? "video" : "in-person";
}

export function buildScheduleHubItem(
  record: ScheduleHubSuggestionRecord,
  currentUserId: string,
  now = new Date(),
): ScheduleHubItem | null {
  const revision = getCurrentScheduleHubRevision(record);
  if (!revision) return null;

  const startsAt = parseIsoDate(record.date_plan?.starts_at ?? revision.starts_at);
  const endsAt = parseIsoDate(record.date_plan?.ends_at ?? revision.ends_at);

  let bucket: ScheduleHubBucket = "pending";
  if (TERMINAL_STATUSES.has(record.status)) {
    bucket = "history";
  } else if (record.status === "accepted") {
    bucket = startsAt && startsAt.getTime() < now.getTime() ? "history" : "upcoming";
  }

  const isProposer = record.proposer_id === currentUserId;
  const canRespond = !isProposer && OPEN_STATUSES.has(record.status) && record.status !== "draft";

  return {
    id: record.id,
    matchId: record.match_id,
    suggestionId: record.id,
    datePlanId: record.date_plan?.id ?? null,
    status: record.status,
    bucket,
    partnerName: record.partner_name,
    partnerUserId: record.partner_user_id,
    partnerAvatar: record.partner_avatar ?? null,
    isProposer,
    isIncoming: !isProposer,
    startsAt,
    endsAt,
    dateTypeKey: revision.date_type_key,
    timeChoiceKey: revision.time_choice_key,
    placeModeKey: revision.place_mode_key,
    venueText: revision.venue_text,
    optionalMessage: revision.optional_message,
    timeBlock: revision.time_block,
    scheduleShareEnabled: revision.schedule_share_enabled,
    scheduleShareExpiresAt: record.schedule_share_expires_at,
    expiresAt: record.expires_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    canAccept: canRespond,
    canDecline: canRespond,
    canCancel: isProposer && OPEN_STATUSES.has(record.status),
  };
}

function sortPending(items: ScheduleHubItem[]): ScheduleHubItem[] {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return bTime - aTime;
  });
}

function sortUpcoming(items: ScheduleHubItem[]): ScheduleHubItem[] {
  return [...items].sort((a, b) => {
    if (a.startsAt && b.startsAt) return a.startsAt.getTime() - b.startsAt.getTime();
    if (a.startsAt) return -1;
    if (b.startsAt) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function sortHistory(items: ScheduleHubItem[]): ScheduleHubItem[] {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return bTime - aTime;
  });
}

export function partitionScheduleHubItems(items: ScheduleHubItem[]) {
  const pending = sortPending(items.filter((item) => item.bucket === "pending"));
  const upcoming = sortUpcoming(items.filter((item) => item.bucket === "upcoming"));
  const history = sortHistory(items.filter((item) => item.bucket === "history"));
  return { pending, upcoming, history };
}

export function toScheduleReminderSources(items: ScheduleHubItem[]): ScheduleReminderSource[] {
  return items
    .filter((item) => item.status === "accepted" && item.startsAt && item.startsAt.getTime() > Date.now())
    .map((item) => ({
      id: item.suggestionId,
      date: item.startsAt as Date,
      mode: deriveMode(item.dateTypeKey),
      status: "accepted" as const,
      senderName: item.partnerName,
      senderAvatar: item.partnerAvatar ?? undefined,
      matchId: item.matchId,
      partnerUserId: item.partnerUserId,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
