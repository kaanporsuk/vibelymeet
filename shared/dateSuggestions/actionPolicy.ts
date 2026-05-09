const RESPONSE_STATUSES = new Set(["proposed", "viewed", "countered"]);
const CANCELLABLE_STATUSES = new Set(["draft", "proposed", "viewed", "countered"]);

export type DateSuggestionActionPolicyInput = {
  status: string;
  currentUserId: string | null | undefined;
  proposerId: string | null | undefined;
  recipientId: string | null | undefined;
  currentRevisionProposedBy: string | null | undefined;
  hasCurrentRevision: boolean;
};

export type DateSuggestionActionPolicy = {
  isParticipant: boolean;
  isOriginalProposer: boolean;
  isOriginalRecipient: boolean;
  isAuthorOfCurrent: boolean;
  canRespondToCurrent: boolean;
  canAccept: boolean;
  canCounter: boolean;
  canNotNow: boolean;
  canDecline: boolean;
  canCancel: boolean;
  canEditDraft: boolean;
};

export function getDateSuggestionActionPolicy(
  input: DateSuggestionActionPolicyInput,
): DateSuggestionActionPolicy {
  const currentUserId = input.currentUserId ?? "";
  const proposerId = input.proposerId ?? "";
  const recipientId = input.recipientId ?? "";
  const currentRevisionProposedBy = input.currentRevisionProposedBy ?? "";
  const isOriginalProposer = Boolean(currentUserId) && currentUserId === proposerId;
  const isOriginalRecipient = Boolean(currentUserId) && currentUserId === recipientId;
  const isParticipant = isOriginalProposer || isOriginalRecipient;
  const isAuthorOfCurrent =
    Boolean(currentUserId) &&
    Boolean(currentRevisionProposedBy) &&
    currentRevisionProposedBy === currentUserId;
  const canRespondToCurrent =
    isParticipant &&
    input.hasCurrentRevision &&
    RESPONSE_STATUSES.has(input.status) &&
    !isAuthorOfCurrent;

  return {
    isParticipant,
    isOriginalProposer,
    isOriginalRecipient,
    isAuthorOfCurrent,
    canRespondToCurrent,
    canAccept: canRespondToCurrent,
    canCounter: canRespondToCurrent,
    canNotNow: canRespondToCurrent,
    canDecline: canRespondToCurrent && isOriginalRecipient,
    canCancel: isOriginalProposer && CANCELLABLE_STATUSES.has(input.status),
    canEditDraft: isOriginalProposer && input.status === "draft",
  };
}
