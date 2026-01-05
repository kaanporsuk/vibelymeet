import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserX, AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSoundEffects } from "@/hooks/useSoundEffects";

interface UnmatchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onReport?: () => void;
  userName: string;
  userAvatar?: string;
  isLoading?: boolean;
}

export const UnmatchDialog = ({
  isOpen,
  onClose,
  onConfirm,
  onReport,
  userName,
  userAvatar,
  isLoading = false,
}: UnmatchDialogProps) => {
  const [step, setStep] = useState<"confirm" | "success">("confirm");
  const { playFeedback, hapticTap } = useSoundEffects();

  const handleConfirm = () => {
    hapticTap();
    playFeedback("wrong", { volume: 0.3 });
    setStep("success");
    setTimeout(() => {
      onConfirm();
      setStep("confirm");
    }, 1200);
  };

  const handleClose = () => {
    setStep("confirm");
    onClose();
  };

  const handleReport = () => {
    hapticTap();
    handleClose();
    onReport?.();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md overflow-hidden">
        <AnimatePresence mode="wait">
          {step === "confirm" ? (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.2 }}
            >
              <DialogHeader className="text-center pb-4">
                <div className="flex flex-col items-center gap-4">
                  {/* Animated icon */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="relative"
                  >
                    <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
                      {userAvatar ? (
                        <img
                          src={userAvatar}
                          alt={userName}
                          className="w-16 h-16 rounded-full object-cover opacity-50 grayscale"
                        />
                      ) : (
                        <UserX className="w-8 h-8 text-destructive" />
                      )}
                    </div>
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1, rotate: [0, -10, 10, -5, 5, 0] }}
                      transition={{ delay: 0.2, duration: 0.5 }}
                      className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-destructive flex items-center justify-center"
                    >
                      <UserX className="w-4 h-4 text-destructive-foreground" />
                    </motion.div>
                  </motion.div>

                  <DialogTitle className="text-xl font-display">
                    Unmatch with {userName}?
                  </DialogTitle>
                </div>
              </DialogHeader>

              <div className="space-y-4 pb-2">
                {/* Warning info */}
                <div className="p-4 rounded-xl bg-secondary/50 border border-border/50">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        This action is permanent
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Your match and entire conversation history will be
                        deleted. {userName} won't be notified but won't be able
                        to contact you.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-col gap-2">
                  <Button
                    variant="destructive"
                    className="w-full h-12"
                    onClick={handleConfirm}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <UserX className="w-4 h-4 mr-2" />
                        Unmatch
                      </>
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    className="w-full h-12"
                    onClick={handleClose}
                    disabled={isLoading}
                  >
                    Keep Match
                  </Button>
                </div>

                {/* Report option */}
                {onReport && (
                  <div className="pt-2 border-t border-border/50">
                    <button
                      onClick={handleReport}
                      className="flex items-center justify-center gap-2 w-full py-3 text-sm text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <ShieldAlert className="w-4 h-4" />
                      Report {userName} instead
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="py-8 text-center"
            >
              {/* Success animation */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.2, 1] }}
                transition={{ duration: 0.4 }}
                className="w-20 h-20 mx-auto rounded-full bg-destructive/20 flex items-center justify-center mb-4"
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <UserX className="w-10 h-10 text-destructive" />
                </motion.div>
              </motion.div>

              {/* Fade out text */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <h3 className="text-lg font-semibold text-foreground">
                  Unmatched
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {userName} has been removed
                </p>
              </motion.div>

              {/* Particle burst effect */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {Array.from({ length: 8 }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{
                      opacity: 1,
                      x: "50%",
                      y: "50%",
                      scale: 0,
                    }}
                    animate={{
                      opacity: 0,
                      x: `${50 + Math.cos((i * Math.PI) / 4) * 50}%`,
                      y: `${50 + Math.sin((i * Math.PI) / 4) * 50}%`,
                      scale: 1,
                    }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="absolute w-2 h-2 rounded-full bg-destructive/50"
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};
