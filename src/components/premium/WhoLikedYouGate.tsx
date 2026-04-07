import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PremiumUpsellDialog } from "@/components/premium/PremiumUpsellDialog";
import { PREMIUM_ENTRY_SURFACE } from "@shared/premiumFunnel";
import { trackEvent } from "@/lib/analytics";

interface WhoLikedYouGateProps {
  count: number;
}

export const WhoLikedYouGate = ({ count }: WhoLikedYouGateProps) => {
  const navigate = useNavigate();
  const [upsellOpen, setUpsellOpen] = useState(false);

  if (count === 0) return null;

  const handleUnlockClick = () => {
    trackEvent("premium_entry_tapped", {
      entry_surface: PREMIUM_ENTRY_SURFACE.WHO_LIKED_YOU,
      feature: "canSeeLikedYou",
      platform: "web",
    });
    setUpsellOpen(true);
  };

  return (
    <>
      <div className="relative glass-card mx-4 my-4 p-4 rounded-2xl overflow-hidden">
        {/* Blurred fake avatars */}
        <div className="flex gap-3 mb-4 blur-md pointer-events-none select-none">
          {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
            <div
              key={i}
              className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/40 to-accent/40 shrink-0"
            />
          ))}
        </div>

        {/* Overlay */}
        <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex flex-col items-center justify-center gap-2 p-4">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <Lock className="w-5 h-5 text-primary" />
          </div>
          <p className="text-sm font-semibold text-foreground text-center">
            {count} {count === 1 ? "person likes" : "people like"} you
          </p>
          <p className="text-xs text-muted-foreground text-center">See who likes you</p>
          <Button size="sm" variant="gradient" onClick={handleUnlockClick} className="mt-1">
            Unlock with Premium
          </Button>
        </div>
      </div>

      <PremiumUpsellDialog
        open={upsellOpen}
        onOpenChange={setUpsellOpen}
        navigate={navigate}
        title="See who vibed you"
        description="Premium includes profiles of people who liked you on Vibely — the same capability shown in your membership benefits."
        funnel={{
          entry_surface: PREMIUM_ENTRY_SURFACE.WHO_LIKED_YOU,
          feature: "canSeeLikedYou",
        }}
        continueLabel="View Premium plans"
      />
    </>
  );
};
