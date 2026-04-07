import { useNavigate } from "react-router-dom";
import { Zap } from "lucide-react";
import { openPremium } from "@/lib/premiumNavigation";
import { PREMIUM_ENTRY_SURFACE } from "@shared/premiumFunnel";

export const PremiumPill = () => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() =>
        openPremium(navigate, { entry_surface: PREMIUM_ENTRY_SURFACE.LOBBY_PREMIUM_PILL })
      }
      className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity"
    >
      <Zap className="w-3 h-3" />
      Premium
    </button>
  );
};
