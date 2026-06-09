import { useState } from "react";
import type { ReactNode } from "react";
import { Heart, Loader2, MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { OtherUserFullProfileView } from "@/components/profile/OtherUserFullProfileView";
import { useOtherUserFullProfile } from "@/hooks/useOtherUserFullProfile";

interface ProfileDetailDrawerProps {
  match: {
    id: string;
    name: string;
    age: number;
    image?: string | null;
    vibes: string[];
    compatibility?: number;
    photos?: string[];
    job?: string;
    location?: string;
    height?: number;
    aboutMe?: string;
    lifestyle?: Record<string, string>;
    prompts?: { question: string; answer: string }[];
    bunnyVideoUid?: string | null;
    bunnyVideoStatus?: string;
    vibeCaption?: string;
    photoVerified?: boolean;
    phoneVerified?: boolean;
  };
  trigger?: ReactNode;
  onMessage?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showActions?: boolean;
  mode?: "discovery" | "match";
}

export const ProfileDetailDrawer = ({
  match,
  trigger,
  onMessage,
  open: controlledOpen,
  onOpenChange,
  showActions = true,
  mode = "match",
}: ProfileDetailDrawerProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const { data: profile, isLoading } = useOtherUserFullProfile(open ? match.id : null);

  const setOpen = (value: boolean) => {
    if (isControlled) {
      onOpenChange?.(value);
    } else {
      setInternalOpen(value);
    }
  };

  const actions = showActions ? (
    <div className="flex flex-wrap items-center gap-2">
      {mode === "discovery" ? (
        <>
          <Button
            type="button"
            variant="outline"
            className="flex-1 rounded-2xl"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
            Pass
          </Button>
          <Button
            type="button"
            variant="gradient"
            className="flex-1 rounded-2xl"
            onClick={() => setOpen(false)}
          >
            <Heart className="h-4 w-4" />
            Like
          </Button>
        </>
      ) : null}
      {onMessage ? (
        <Button
          type="button"
          variant="default"
          className="flex-1 rounded-2xl"
          onClick={() => {
            setOpen(false);
            onMessage();
          }}
        >
          <MessageCircle className="h-4 w-4" />
          Message
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {trigger ? <DrawerTrigger asChild>{trigger}</DrawerTrigger> : null}
      <DrawerContent className="max-h-[95dvh] min-h-[70dvh] overflow-hidden rounded-t-[28px] border-border bg-background p-0">
        {isLoading ? (
          <div className="flex h-[70dvh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : profile ? (
          <div className="max-h-[95dvh] overflow-y-auto">
            <OtherUserFullProfileView
              profile={profile}
              onClose={() => setOpen(false)}
              closeLabel="Close"
              compatibilityPercent={match.compatibility}
              actions={actions}
            />
          </div>
        ) : (
          <div className="flex h-[70dvh] flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-lg font-semibold text-foreground">Profile unavailable</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {match.name}'s profile cannot be opened right now.
            </p>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
};
