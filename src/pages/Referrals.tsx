import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Copy, Share2, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/navigation/BottomNav";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { buildInviteLandingUrl } from "@/lib/inviteLinks";
import { isWebShareAbortError } from "@/lib/webShare";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

const SHARE_TITLE = "Join me on Vibely!";
const SHARE_MESSAGE = "I'm using Vibely for video dates and real events. Come find your vibe with me.";

type ReferralStatus = {
  referredById: string | null;
  referredByName: string | null;
};

export default function Referrals() {
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const { session } = useAuth();
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);

  const userId = session?.user?.id ?? user?.id ?? null;
  const inviteReady = Boolean(userId);
  const inviteLink = useMemo(() => buildInviteLandingUrl(userId), [userId]);

  useEffect(() => {
    trackEvent("invite_hub_viewed", { platform: "web" });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      if (!userId) {
        setStatus(null);
        setIsLoadingStatus(false);
        return;
      }

      setIsLoadingStatus(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("referred_by")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.warn("[referrals] failed to load status", error.message);
        setStatus({ referredById: null, referredByName: null });
        setIsLoadingStatus(false);
        return;
      }

      const referredById = data?.referred_by ?? null;
      if (!referredById) {
        setStatus({ referredById: null, referredByName: null });
        setIsLoadingStatus(false);
        return;
      }

      const { data: referrerData, error: referrerError } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", referredById)
        .maybeSingle();

      if (cancelled) return;
      if (referrerError) {
        console.warn("[referrals] failed to load referrer", referrerError.message);
      }

      setStatus({
        referredById,
        referredByName: referrerData?.name?.trim() || null,
      });
      setIsLoadingStatus(false);
    };

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleCopy = async () => {
    if (!inviteReady) {
      toast.error("Your invite link is still loading.");
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success("Invite link copied.");
      trackEvent("invite_link_copied", { surface: "referrals_hub", channel: "clipboard" });
    } catch {
      toast.error("Could not copy invite link.");
    }
  };

  const handleShare = async () => {
    if (!inviteReady) {
      toast.error("Your invite link is still loading.");
      return;
    }
    try {
      await navigator.share({
        title: SHARE_TITLE,
        text: SHARE_MESSAGE,
        url: inviteLink,
      });
      trackEvent("invite_link_shared", { surface: "referrals_hub", channel: "system_share" });
    } catch (error) {
      if (isWebShareAbortError(error)) return;
      await handleCopy();
    }
  };

  const statusTitle = isLoadingStatus
    ? "Checking your invite status"
    : status?.referredById
      ? status.referredByName
        ? `You joined from ${status.referredByName}'s invite`
        : "You joined from a friend's invite"
      : "No friend invite connected";

  const statusBody = isLoadingStatus
    ? "We’re loading the current referral attribution on your account."
    : status?.referredById
      ? "Your account is already connected to an inviter, so future shares keep your existing attribution intact."
      : "You can still invite friends with your personal link. If they sign up from it, Vibely connects the signup to your account once.";
  const inviteTitle = inviteReady ? "Your invite link is ready" : "Preparing your invite link";
  const inviteBody = inviteReady
    ? "Share your Vibely invite. Friends can open it in their browser and create an account from your link."
    : "Hang tight while Vibely loads your account. Your personal link will appear here in a moment.";

  return (
    <div className="min-h-screen bg-background pb-[100px]">
      <header className="sticky top-0 z-40 glass-card border-b border-border/50 px-4 py-4">
        <div className="mx-auto flex max-w-lg items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Growth</p>
            <h1 className="text-xl font-display font-bold text-foreground">Invite friends</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-background to-accent/10 p-5"
        >
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15">
              <UserPlus className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-display font-semibold text-foreground">{inviteTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{inviteBody}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-background/70 p-3" aria-busy={!inviteReady}>
            <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">Invite Link</p>
            <p className="break-all text-sm text-foreground">
              {inviteReady ? inviteLink : "Loading your personal link..."}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button onClick={() => void handleShare()} className="gap-2" disabled={!inviteReady}>
              <Share2 className="h-4 w-4" />
              Share
            </Button>
            <Button variant="outline" onClick={() => void handleCopy()} className="gap-2" disabled={!inviteReady}>
              <Copy className="h-4 w-4" />
              Copy link
            </Button>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card p-5"
        >
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-display font-semibold text-foreground">{statusTitle}</h2>
              <p className="text-sm text-muted-foreground">{statusBody}</p>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-5"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-pink-500/10">
              <Sparkles className="h-5 w-5 text-pink-400" />
            </div>
            <div>
              <h2 className="text-base font-display font-semibold text-foreground">How it works</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A friend can use your invite when joining Vibely. There are no rewards to track right now;
                this simply helps Vibely understand who invited whom.
              </p>
            </div>
          </div>
        </motion.section>
      </main>

      <BottomNav />
    </div>
  );
}
