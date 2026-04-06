import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Crown, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/useSubscription";
import { useEntitlements } from "@/hooks/useEntitlements";
import { usePremium } from "@/hooks/usePremium";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  getSettingsAccessDateLine,
  getSettingsPlanLabel,
  showSettingsMemberElevated,
} from "@shared/settingsMembershipDisplay";

/**
 * Membership DISPLAY only — see @shared/settingsMembershipDisplay for precedence.
 * Billable state from `subscriptions`; tier label from profiles.subscription_tier; grant dates from premium_until.
 */
export const PremiumSettingsCard = () => {
  const navigate = useNavigate();
  const { isPremium: hasBillableSubscription, subscription, isLoading: subLoading } = useSubscription();
  const { tierId, tierLabel, isLoading: entLoading } = useEntitlements();
  const { premiumUntil, isLoading: premLoading } = usePremium();
  const [isLoadingPortal, setIsLoadingPortal] = useState(false);

  const displayInput = {
    tierId,
    tierLabel,
    hasBillableSubscription,
    subscriptionPeriodEndIso: subscription.current_period_end,
    premiumUntil,
  };

  const planLabel = getSettingsPlanLabel(displayInput);
  const accessLine = getSettingsAccessDateLine(displayInput);
  const showElevatedCard = showSettingsMemberElevated(displayInput);

  if (subLoading || entLoading || premLoading) return null;

  const handleManageSubscription = async () => {
    setIsLoadingPortal(true);
    const { data, error } = await supabase.functions.invoke(
      'create-portal-session'
    );
    if (error || !data?.success) {
      toast.error('Could not open billing portal. Try again.');
      setIsLoadingPortal(false);
      return;
    }
    window.location.href = data.url;
  };

  if (showElevatedCard) {
    return (
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Crown className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground text-xs font-semibold">
              ✦ Vibely {planLabel}
            </span>
            {accessLine ? (
              <p className="text-xs text-muted-foreground mt-1">
                {accessLine.kind === "renews"
                  ? `Renews ${format(new Date(accessLine.iso), "MMM d, yyyy")}`
                  : `Access through ${format(new Date(accessLine.iso), "MMM d, yyyy")}`}
              </p>
            ) : null}
          </div>
        </div>
        {hasBillableSubscription ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={handleManageSubscription}
            disabled={isLoadingPortal}
          >
            {isLoadingPortal ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ExternalLink className="w-4 h-4" />
            )}
            Manage Subscription
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-accent/5 p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
          <Crown className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-display font-semibold text-foreground">Upgrade to Premium</h3>
          <p className="text-xs text-muted-foreground">Unlock all features</p>
        </div>
        <Button size="sm" variant="gradient" onClick={() => navigate("/premium")}>
          Go Premium
        </Button>
      </div>
    </div>
  );
};
