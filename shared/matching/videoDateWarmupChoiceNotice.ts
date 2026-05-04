export type VideoDateWarmupChoiceNoticeActor = "self" | "partner" | "both" | "fallback";

export type VideoDateWarmupChoiceNotice = {
  actor: VideoDateWarmupChoiceNoticeActor;
  title: string;
  message: string;
};

type WarmupChoiceNoticeInput = {
  waitingForSelf?: boolean | null;
  waitingForPartner?: boolean | null;
};

export function getVideoDateWarmupChoiceNotice({
  waitingForSelf,
  waitingForPartner,
}: WarmupChoiceNoticeInput = {}): VideoDateWarmupChoiceNotice {
  const self = waitingForSelf === true;
  const partner = waitingForPartner === true;

  if (self && !partner) {
    return {
      actor: "self",
      title: "Warm-up ended",
      message: "Make your private choice when it feels right.",
    };
  }

  if (!self && partner) {
    return {
      actor: "partner",
      title: "Choice saved",
      message: "You'll only match if you both choose Vibe.",
    };
  }

  if (self && partner) {
    return {
      actor: "both",
      title: "Warm-up ended",
      message: "Make your private choice when it feels right.",
    };
  }

  return {
    actor: "fallback",
    title: "Warm-up ended",
    message: "Make your private choice when it feels right.",
  };
}
