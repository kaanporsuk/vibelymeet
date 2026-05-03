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
      title: "Warm-up wrapped before you chose",
      message: "No Vibe or Pass was selected, so this one won't move forward.",
    };
  }

  if (!self && partner) {
    return {
      actor: "partner",
      title: "Warm-up wrapped before they chose",
      message: "They didn't choose Vibe or Pass, so this one won't move forward.",
    };
  }

  if (self && partner) {
    return {
      actor: "both",
      title: "Warm-up wrapped without both choices",
      message: "No Vibe or Pass choices were selected, so this one won't move forward.",
    };
  }

  return {
    actor: "fallback",
    title: "Warm-up wrapped",
    message: "The warm-up ended before both choices were in, so this one won't move forward.",
  };
}
