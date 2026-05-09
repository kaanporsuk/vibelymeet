import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { recordInviteLandingGrowth } from "../../shared/referralGrowthAttribution";
import { readReferralIdFromSearchParams } from "../../shared/referrals";

/** Marketing URL `/invite?ref=` → signup with referral preserved (matches native share links). */
export default function InviteRedirect() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const handledRef = useRef<string | null>(null);
  const normalizedRef = readReferralIdFromSearchParams(searchParams);
  const next = normalizedRef ? `/auth?ref=${encodeURIComponent(normalizedRef)}` : "/auth";

  useEffect(() => {
    if (handledRef.current === next) {
      return;
    }
    handledRef.current = next;

    void recordInviteLandingGrowth(
      supabase as unknown as Parameters<typeof recordInviteLandingGrowth>[0],
      normalizedRef,
      { platform: "web", surface: "invite_redirect" },
    ).then((results) => {
      const failed = results.find((result) => result.status === "failed");
      if (failed) {
        console.warn("[referrals] failed to record invite landing", failed.message);
      }
    });
    navigate(next, { replace: true });
  }, [navigate, next, normalizedRef]);

  return null;
}
