import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WhoLikedYouGateProps {
  count: number;
}

export const WhoLikedYouGate = ({ count }: WhoLikedYouGateProps) => {
  const navigate = useNavigate();

  if (count === 0) return null;

  return (
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
        <Button
          size="sm"
          variant="gradient"
          onClick={() => navigate("/premium")}
          className="mt-1"
        >
          Unlock with Premium
        </Button>
      </div>
    </div>
  );
};
