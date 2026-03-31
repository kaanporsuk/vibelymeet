import { useEffect, useState } from "react";
import {
  X,
  ChevronRight,
  CheckCircle2,
  Images,
  Video,
  MessageCircle,
  FileText,
  Type,
  Heart,
  Briefcase,
  Ruler,
  Leaf,
  Phone,
  Mail,
  Camera,
  User,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import {
  getIncompleteVibeScoreActions,
  getNextTierLine,
  tierLabelFromScore,
  type VibeScoreActionIcon,
  type VibeScoreActionId,
  type VibeScoreProfileSnapshot,
} from "@/lib/vibeScoreIncompleteActions";

const PILL_LIMIT = 6;

const ICON_MAP: Record<VibeScoreActionIcon, LucideIcon> = {
  images: Images,
  video: Video,
  message: MessageCircle,
  fileText: FileText,
  type: Type,
  heart: Heart,
  briefcase: Briefcase,
  ruler: Ruler,
  leaf: Leaf,
  phone: Phone,
  mail: Mail,
  camera: Camera,
  user: User,
  sparkles: Sparkles,
};

export type VibeScoreDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: VibeScoreProfileSnapshot;
  score: number;
  vibeScoreLabel?: string | null;
  onAction: (action: VibeScoreActionId) => void;
};

export function VibeScoreDrawer({
  open,
  onOpenChange,
  profile,
  score,
  vibeScoreLabel,
  onAction,
}: VibeScoreDrawerProps) {
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (open) setShowAll(false);
  }, [open]);

  const clamped = Math.min(100, Math.max(0, score));
  const tierLabel = (vibeScoreLabel ?? "").trim() || tierLabelFromScore(clamped);
  const nextTier = getNextTierLine(clamped);
  const actions = getIncompleteVibeScoreActions(profile);
  const hasIncomplete = actions.length > 0;
  const displayed = showAll ? actions : actions.slice(0, PILL_LIMIT);
  const hiddenCount = Math.max(0, actions.length - PILL_LIMIT);

  const handlePill = (id: VibeScoreActionId) => {
    onOpenChange(false);
    requestAnimationFrame(() => onAction(id));
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh] border-white/10 bg-zinc-950">
        <DrawerHeader className="relative border-b border-white/5 pb-3">
          <DrawerTitle className="text-center font-display text-lg text-white">Vibe Score</DrawerTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </DrawerHeader>

        <div className="max-h-[min(78vh,620px)] overflow-y-auto px-4 pb-8 pt-2">
          <p className="text-3xl font-display font-bold text-white">{Math.round(clamped)}</p>
          <p className="mt-1 text-[15px] font-semibold text-pink-500">
            Vibe Score · {tierLabel}
          </p>
          {nextTier ? (
            <p className="mt-2 text-sm text-gray-400">
              Next tier: {nextTier.name} at {nextTier.at}
            </p>
          ) : (
            <div className="mt-2 flex items-center gap-1.5 text-sm text-gray-400">
              <CheckCircle2 className="h-4 w-4 text-teal-400" />
              <span>Maxed out</span>
            </div>
          )}

          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-pink-500"
              style={{ width: `${clamped}%` }}
            />
          </div>

          <p className="mt-6 text-[13px] font-semibold text-gray-400">Boost your score</p>

          {hasIncomplete ? (
            <div className="mt-2.5 space-y-2">
              {displayed.map((a) => {
                const Icon = ICON_MAP[a.icon];
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => handlePill(a.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.06] px-4 py-3 text-left",
                      "transition-opacity hover:opacity-90 active:opacity-80",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0 text-violet-400" />
                    <span className="min-w-0 flex-1 text-[13px] font-medium text-white">{a.label}</span>
                    <span className="shrink-0 text-[13px] font-bold text-violet-400">+{a.points}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-white/25" />
                  </button>
                );
              })}
              {!showAll && hiddenCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="w-full py-2.5 text-center text-sm font-semibold text-violet-400"
                >
                  See all ({actions.length})
                </button>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-center text-[15px] font-semibold text-white">
              Your profile is in the top tier
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
