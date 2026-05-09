import { normalizeReferralId } from "./referrals";

export type ReferralGrowthPlatform = "web" | "native";

export type ReferralGrowthEventType =
  | "landing"
  | "invite_click"
  | "event_share_click"
  | "signup_seen"
  | "claim_attempt";

export type ReferralGrowthContext = {
  platform: ReferralGrowthPlatform;
  surface: string;
  city?: string | null;
  eventId?: string | null;
  isPremium?: boolean | null;
};

export type ReferralGrowthEventBody = {
  referral_token: string | null;
  event_type: ReferralGrowthEventType;
  surface: string;
  context: {
    platform: ReferralGrowthPlatform;
    surface: string;
    city?: string;
    event_id?: string;
    is_premium?: boolean;
  };
};

export type ReferralGrowthFunctionClient = {
  functions: {
    invoke: (
      fn: "record-growth-attribution",
      options: { body: ReferralGrowthEventBody },
    ) => PromiseLike<{ data: unknown; error: unknown | null }>;
  };
};

function cleanToken(value: string | null | undefined): string | null {
  return normalizeReferralId(value);
}

function cleanSurface(surface: string): string {
  const trimmed = surface.trim();
  return /^[a-zA-Z0-9_.:/-]{1,64}$/.test(trimmed) ? trimmed : "unknown";
}

export function buildReferralGrowthContext(context: ReferralGrowthContext): ReferralGrowthEventBody["context"] {
  const surface = cleanSurface(context.surface);
  const out: ReferralGrowthEventBody["context"] = {
    platform: context.platform,
    surface,
  };
  if (context.city?.trim()) out.city = context.city.trim().slice(0, 64);
  if (context.eventId?.trim()) out.event_id = context.eventId.trim().slice(0, 128);
  if (typeof context.isPremium === "boolean") out.is_premium = context.isPremium;
  return out;
}

export function buildReferralGrowthEventBody(params: {
  referralToken?: string | null;
  eventType: ReferralGrowthEventType;
  context: ReferralGrowthContext;
}): ReferralGrowthEventBody {
  const context = buildReferralGrowthContext(params.context);
  return {
    referral_token: cleanToken(params.referralToken),
    event_type: params.eventType,
    surface: context.surface,
    context,
  };
}

export async function recordReferralGrowthEvent(
  client: ReferralGrowthFunctionClient,
  params: {
    referralToken?: string | null;
    eventType: ReferralGrowthEventType;
    context: ReferralGrowthContext;
  },
): Promise<{ status: "recorded" } | { status: "failed"; message: string }> {
  try {
    const { error } = await client.functions.invoke("record-growth-attribution", {
      body: buildReferralGrowthEventBody(params),
    });
    if (error) {
      return { status: "failed", message: error instanceof Error ? error.message : String(error) };
    }
    return { status: "recorded" };
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

export async function recordInviteLandingGrowth(
  client: ReferralGrowthFunctionClient,
  referralToken: string | null | undefined,
  context: ReferralGrowthContext,
): Promise<Array<{ status: "recorded" } | { status: "failed"; message: string }>> {
  const token = cleanToken(referralToken);
  const results = [
    await recordReferralGrowthEvent(client, {
      referralToken: token,
      eventType: "landing",
      context,
    }),
  ];

  if (token) {
    results.push(
      await recordReferralGrowthEvent(client, {
        referralToken: token,
        eventType: "invite_click",
        context,
      }),
    );
  }

  return results;
}
