import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCredits } from "@/hooks/useCredits";
import { trackEvent } from "@/lib/analytics";
import { toast } from "sonner";

const PACK_LABELS: Record<string, string> = {
  extra_time_3: "+3 Extra Time credits",
  extended_vibe_3: "+3 Extended Vibe credits",
  bundle_3_3: "+3 Extra Time + 3 Extended Vibe credits",
};

const CreditsSuccess = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { refetch, credits } = useCredits();
  const pack = params.get("pack") || "";
  const label = PACK_LABELS[pack] || "Credits added";
  const didRunRef = useRef(false);
  const [balanceReady, setBalanceReady] = useState(false);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;
    if (pack) trackEvent("credit_purchase_completed", { pack });
    document.title = "Video Date Credits — Success";
    window.history.replaceState({}, document.title, "/credits/success");
    void (async () => {
      await refetch();
      setBalanceReady(true);
      toast.success("Credits added — your balance is updated.");
    })();
  }, [pack, refetch]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center max-w-sm space-y-6 w-full"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", delay: 0.2, stiffness: 200 }}
          className="w-20 h-20 rounded-full bg-accent/20 flex items-center justify-center mx-auto"
        >
          <Sparkles className="w-10 h-10 text-accent" />
        </motion.div>

        <h1 className="text-2xl font-display font-bold text-foreground">Credits Added! ⚡</h1>
        <p className="text-primary font-semibold">{label}</p>
        <p className="text-sm text-muted-foreground">Use them during your next video date</p>

        {balanceReady ? (
          <div className="glass-card rounded-xl p-4 text-left border border-border/60 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your balance now</p>
            <p className="text-base font-semibold text-foreground">
              Extra Time <span className="tabular-nums">{credits.extraTime}</span>
              <span className="text-muted-foreground font-normal"> · </span>
              Extended Vibe <span className="tabular-nums">{credits.extendedVibe}</span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Updating your balance…</p>
        )}

        <Button variant="gradient" className="w-full" onClick={() => navigate("/")}>
          Got it
        </Button>
      </motion.div>
    </div>
  );
};

export default CreditsSuccess;
