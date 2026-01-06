import { Clock, BellOff, Check } from "lucide-react";
import { motion } from "framer-motion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { MuteDuration } from "@/hooks/useMuteMatch";

interface MuteOption {
  value: MuteDuration;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const muteOptions: MuteOption[] = [
  {
    value: "1hour",
    label: "1 Hour",
    description: "Take a quick break",
    icon: <Clock className="w-5 h-5" />,
  },
  {
    value: "1day",
    label: "1 Day",
    description: "Silence for 24 hours",
    icon: <Clock className="w-5 h-5" />,
  },
  {
    value: "1week",
    label: "1 Week",
    description: "A longer pause",
    icon: <Clock className="w-5 h-5" />,
  },
  {
    value: "forever",
    label: "Until I turn it back on",
    description: "Mute indefinitely",
    icon: <BellOff className="w-5 h-5" />,
  },
];

interface MuteOptionsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDuration: (duration: MuteDuration) => void;
  userName: string;
  currentlyMuted?: boolean;
  onUnmute?: () => void;
}

export const MuteOptionsSheet = ({
  isOpen,
  onClose,
  onSelectDuration,
  userName,
  currentlyMuted,
  onUnmute,
}: MuteOptionsSheetProps) => {
  const handleSelect = (duration: MuteDuration) => {
    onSelectDuration(duration);
    onClose();
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-center">
            Mute notifications from {userName}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-2 pb-6">
          {currentlyMuted && onUnmute && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => {
                onUnmute();
                onClose();
              }}
              className="w-full flex items-center gap-4 p-4 rounded-xl bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                <Check className="w-5 h-5" />
              </div>
              <div className="text-left flex-1">
                <p className="font-medium text-foreground">Unmute</p>
                <p className="text-sm text-muted-foreground">
                  Turn notifications back on
                </p>
              </div>
            </motion.button>
          )}

          {muteOptions.map((option, index) => (
            <motion.button
              key={option.value}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => handleSelect(option.value)}
              className="w-full flex items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                {option.icon}
              </div>
              <div className="text-left flex-1">
                <p className="font-medium text-foreground">{option.label}</p>
                <p className="text-sm text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </motion.button>
          ))}
        </div>

        <Button
          variant="ghost"
          className="w-full"
          onClick={onClose}
        >
          Cancel
        </Button>
      </SheetContent>
    </Sheet>
  );
};
