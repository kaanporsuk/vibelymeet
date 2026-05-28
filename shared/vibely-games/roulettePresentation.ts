export type RouletteViewerRole = "starter" | "receiver" | "unknown";

type ResolveRouletteViewerRoleInput = {
  currentUserId?: string | null;
  starterUserId?: string | null;
  fallbackViewerIsStarter?: boolean;
};

type ResolveRouletteAnswerLabelsInput = ResolveRouletteViewerRoleInput & {
  partnerName?: string | null;
};

export type RouletteAnswerLabels = {
  viewerRole: RouletteViewerRole;
  senderAnswerLabel: string;
  receiverAnswerLabel: string;
};

function cleanId(id: string | null | undefined): string | null {
  const trimmed = id?.trim();
  return trimmed ? trimmed : null;
}

function partnerAnswerLabel(partnerName: string | null | undefined): string {
  const name = partnerName?.trim();
  if (!name || name.toLowerCase() === "them" || name.toLowerCase() === "match") {
    return "Their answer";
  }
  return `${name}${/[sS]$/.test(name) ? "'" : "'s"} answer`;
}

export function resolveRouletteViewerRole({
  currentUserId,
  starterUserId,
  fallbackViewerIsStarter,
}: ResolveRouletteViewerRoleInput): RouletteViewerRole {
  const current = cleanId(currentUserId);
  const starter = cleanId(starterUserId);

  if (current && starter) {
    return current === starter ? "starter" : "receiver";
  }

  if (typeof fallbackViewerIsStarter === "boolean") {
    return fallbackViewerIsStarter ? "starter" : "receiver";
  }

  return "unknown";
}

export function resolveRouletteAnswerLabels(input: ResolveRouletteAnswerLabelsInput): RouletteAnswerLabels {
  const viewerRole = resolveRouletteViewerRole(input);
  const otherAnswer = partnerAnswerLabel(input.partnerName);

  if (viewerRole === "starter") {
    return {
      viewerRole,
      senderAnswerLabel: "Your answer",
      receiverAnswerLabel: otherAnswer,
    };
  }

  if (viewerRole === "receiver") {
    return {
      viewerRole,
      senderAnswerLabel: otherAnswer,
      receiverAnswerLabel: "Your answer",
    };
  }

  return {
    viewerRole,
    senderAnswerLabel: "Starter's answer",
    receiverAnswerLabel: "Reply answer",
  };
}
