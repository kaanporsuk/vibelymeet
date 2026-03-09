import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Clock, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/BottomNav";
import { useCredits } from "@/hooks/useCredits";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";

const PACKS = [
  {
    id: "extra_time_3",
    name: "3× Extra Time",
    description: "Extend your date by +2 min, 3 times",
    price: "€2.99",
    icon: Clock,
    iconColor: "text-primary",
    bgColor: "bg-primary/20",
    highlight: false,
  },
  {
    id: "extended_vibe_3",
    name: "3× Extended Vibe",
    description: "Extend your date by +5 min, 3 times",
    price: "€4.99",
    icon: Sparkles,
    iconColor: "text-accent",
    bgColor: "bg-accent/20",
    highlight: false,
  },
  {
    id: "bundle_3_3",
    name: "Vibe Bundle",
    description: "3× Extra Time + 3× Extended Vibe",
    price: "€5.99",
    originalPrice: "€7.98",
    icon: Zap,
    iconColor: "text-primary",
    bgColor: "bg-gradient-to-br from-primary/20 to-accent/20",
    highlight: true,
  },
];

const Credits = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { credits, isLoading, refetch } = useCredits();
  const [loadingPack, setLoadingPack] = useState<string | null>(null);

  // Handle cancel return from Stripe
  useEffect(() => {
    const cancelled = searchParams.get("cancelled");
    if (cancelled === "true") {
      toast.info("Purchase cancelled — no charges made");
      // Clean up URL
      window.history.replaceState({}, document.title, "/credits");
    }
  }, [searchParams]);

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-muted-foreground">Sign in to purchase credits</p>
        <Button onClick={() => navigate("/auth")}>Sign In</Button>
      </div>
    );
  }

  const handlePurchase = async (packId: string) => {
    if (!navigator.onLine) {
      toast.error("You're offline — purchases need a connection");
      return;
    }
    Sentry.addBreadcrumb({ category: "purchase", message: `Initiating checkout for ${packId}`, level: "info" });
    setLoadingPack(packId);
    const { data, error } = await supabase.functions.invoke(
      "create-credits-checkout",
      { body: { packId } }
    );
    if (error || !data?.success) {
      toast.error(data?.error || "Something went wrong");
      setLoadingPack(null);
      return;
    }
    window.location.href = data.url;
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 glass-card border-b border-border/50 px-4 py-4">
        <div className="flex items-center gap-4 max-w-lg mx-auto">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-display font-bold text-foreground">Get More Time</h1>
            <p className="text-xs text-muted-foreground">Don't let a great conversation end too soon</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Current balance */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-4 text-center"
        >
          <p className="text-xs text-muted-foreground mb-1">Your balance</p>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">{credits.extraTime} Extra Time</span>
              </div>
              <span className="text-muted-foreground">·</span>
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold text-foreground">{credits.extendedVibe} Extended Vibe</span>
              </div>
            </div>
          )}
        </motion.div>

        {/* Credit packs */}
        <div className="space-y-3">
          {PACKS.map((pack, i) => {
            const Icon = pack.icon;
            return (
              <motion.div
                key={pack.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className={`relative glass-card p-4 ${
                  pack.highlight
                    ? "border border-primary/50 shadow-[0_0_20px_-5px_hsl(var(--primary)/0.3)]"
                    : ""
                }`}
              >
                {pack.highlight && (
                  <span className="absolute -top-2.5 right-4 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground text-[10px] font-bold uppercase tracking-wider">
                    Best Value
                  </span>
                )}

                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl ${pack.bgColor} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-6 h-6 ${pack.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-semibold text-foreground">{pack.name}</h3>
                    <p className="text-xs text-muted-foreground">{pack.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-display font-bold text-foreground">{pack.price}</p>
                    {pack.originalPrice && (
                      <p className="text-xs text-muted-foreground line-through">{pack.originalPrice}</p>
                    )}
                  </div>
                </div>

                <Button
                  variant={pack.highlight ? "gradient" : "outline"}
                  className="w-full mt-3"
                  disabled={loadingPack !== null}
                  onClick={() => handlePurchase(pack.id)}
                >
                  {loadingPack === pack.id ? "Redirecting…" : pack.highlight ? "Get Bundle" : "Buy Pack"}
                </Button>
              </motion.div>
            );
          })}
        </div>
      </main>

      <BottomNav />
    </div>
  );
};

export default Credits;
