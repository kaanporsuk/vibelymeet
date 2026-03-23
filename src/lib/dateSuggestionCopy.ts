/** Keys sent to `date_suggestion_apply` revision payload (snake_case). */

export const DATE_TYPE_OPTIONS = [
  { key: "coffee", label: "Coffee" },
  { key: "drinks", label: "Drinks" },
  { key: "walk", label: "Walk" },
  { key: "dinner", label: "Dinner" },
  { key: "activity", label: "Activity" },
  { key: "event_together", label: "Event together" },
  { key: "video_date", label: "Video date" },
  { key: "concerts", label: "Concerts" },
  { key: "night_out", label: "Night out / Clubbing" },
  { key: "brunch", label: "Brunch" },
  { key: "cinema_theater", label: "Cinema / Theater" },
  { key: "gym_date", label: "Gym Date" },
  { key: "custom", label: "Custom" },
] as const;

export const TIME_CHOICE_OPTIONS = [
  { key: "tonight", label: "Tonight" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "this_weekend", label: "This weekend" },
  { key: "next_week", label: "Next week" },
  { key: "pick_a_time", label: "Pick a time" },
  { key: "share_schedule", label: "Share your Vibely Schedule" },
] as const;

export const PLACE_MODE_OPTIONS = [
  { key: "ill_choose", label: "I'll choose a place" },
  { key: "decide_together", label: "Let's decide together" },
  { key: "near_me", label: "Near me" },
  { key: "near_you", label: "Near you" },
  { key: "midway", label: "Midway" },
  { key: "up_to_you", label: "Up to you" },
  { key: "custom_venue", label: "Custom venue name" },
] as const;

export type DateTypeKey = (typeof DATE_TYPE_OPTIONS)[number]["key"];
export type TimeChoiceKey = (typeof TIME_CHOICE_OPTIONS)[number]["key"];
export type PlaceModeKey = (typeof PLACE_MODE_OPTIONS)[number]["key"];

/** Four tones × short optional openers per date type (preselected = index 0). */
export const OPTIONAL_MESSAGE_VARIANTS: Record<string, [string, string, string, string]> = {
  coffee: [
    "Coffee sounds perfect — can't wait to catch up.",
    "Low-key coffee and good convo?",
    "Let's grab coffee and see where the vibe goes.",
    "Quick coffee date? I'm in.",
  ],
  drinks: [
    "Drinks this week? I'd love to.",
    "Cheers to meeting up — pick a spot?",
    "Casual drinks and zero pressure.",
    "Let's grab a drink and vibe.",
  ],
  walk: [
    "A walk sounds refreshing — let's do it.",
    "Stretch the legs and chat?",
    "Easy walk, good company.",
    "Walk & talk — simple and nice.",
  ],
  dinner: [
    "Dinner together? I'd really like that.",
    "Let's pick a night and a spot.",
    "Good food, better company.",
    "Dinner date — name the place.",
  ],
  activity: [
    "Let's do something fun together.",
    "Activity date — I'm flexible on what.",
    "Up for an adventure?",
    "Pick something we'd both enjoy.",
  ],
  event_together: [
    "Let's make it an event night together.",
    "Event together — sounds like a plan.",
    "I'd love to share an event with you.",
    "Pick something we'd both enjoy.",
  ],
  video_date: [
    "Video date? I'd love to see you on screen.",
    "Let's keep it virtual and cozy.",
    "Quick video catch-up?",
    "Face-to-face from home works for me.",
  ],
  concerts: [
    "Live music together? Count me in.",
    "Concert night — let's lock a date.",
    "Tickets and good vibes.",
    "Let's catch a show.",
  ],
  night_out: [
    "Night out — let's go out out.",
    "Dancing or clubbing? I'm game.",
    "Big night energy — you in?",
    "Let's paint the town.",
  ],
  brunch: [
    "Brunch is always a good idea.",
    "Eggs, coffee, and you.",
    "Late morning date?",
    "Brunch & easy vibes.",
  ],
  cinema_theater: [
    "Movie or show night?",
    "Popcorn + good company.",
    "Let's pick a film or play.",
    "Culture date — I'm in.",
  ],
  gym_date: [
    "Gym date? Let's motivate each other.",
    "Workout buddies — why not.",
    "Active date sounds fun.",
    "Sweat first, coffee after?",
  ],
  custom: [
    "I'd love to plan something together.",
    "Your idea or mine — let's decide.",
    "Custom date — tell me what you're thinking.",
    "Let's make it ours.",
  ],
};

export function labelForDateType(key: string): string {
  return DATE_TYPE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}
export function labelForTimeChoice(key: string): string {
  return TIME_CHOICE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}
export function labelForPlaceMode(key: string): string {
  return PLACE_MODE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

export const DATE_SAFETY_NOTE =
  "Meet in public first, tell a friend where you're going, and trust your instincts.";

export function buildShareDateText(params: {
  partnerFirstName: string;
  dateTypeLabel: string;
  placeLabel: string;
  timeLabel: string;
  optionalMessage?: string | null;
  appUrl?: string;
}): string {
  const lines = [
    `Date with ${params.partnerFirstName}`,
    `${params.dateTypeLabel}`,
    `${params.placeLabel}`,
    `${params.timeLabel}`,
    "",
    params.optionalMessage?.trim() ? params.optionalMessage.trim() : "",
    "",
    DATE_SAFETY_NOTE,
    "",
    params.appUrl ?? (typeof window !== "undefined" ? window.location.origin : "https://vibelymeet.com"),
  ].filter((l) => l !== "");
  return lines.join("\n");
}
