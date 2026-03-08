import { useNavigate } from "react-router-dom";
import { Zap } from "lucide-react";

export const PremiumPill = () => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate("/premium")}
      className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity"
    >
      <Zap className="w-3 h-3" />
      Premium
    </button>
  );
};
