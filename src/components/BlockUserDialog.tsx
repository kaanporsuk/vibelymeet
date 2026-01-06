import { useState } from "react";
import { ShieldAlert, UserX, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface BlockUserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  userName: string;
  userAvatar?: string;
  isLoading?: boolean;
}

export const BlockUserDialog = ({
  isOpen,
  onClose,
  onConfirm,
  userName,
  userAvatar,
  isLoading,
}: BlockUserDialogProps) => {
  const [reason, setReason] = useState("");
  const [showReasonInput, setShowReasonInput] = useState(false);

  const handleConfirm = () => {
    onConfirm(reason || undefined);
    setReason("");
    setShowReasonInput(false);
  };

  const handleClose = () => {
    setReason("");
    setShowReasonInput(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm rounded-3xl border-destructive/20">
        <DialogHeader className="text-center pb-2">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-16 h-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center"
          >
            {userAvatar ? (
              <div className="relative">
                <img
                  src={userAvatar}
                  alt={userName}
                  className="w-14 h-14 rounded-full object-cover opacity-50"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <ShieldAlert className="w-8 h-8 text-destructive" />
                </div>
              </div>
            ) : (
              <ShieldAlert className="w-8 h-8 text-destructive" />
            )}
          </motion.div>
          <DialogTitle className="text-xl font-display">
            Block {userName}?
          </DialogTitle>
          <DialogDescription className="text-muted-foreground pt-2">
            This will permanently prevent {userName} from contacting you or seeing your profile. They won't be notified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              Blocking is permanent and cannot be undone from the app. Contact support if you need to unblock someone.
            </p>
          </div>

          <AnimatePresence mode="wait">
            {showReasonInput ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Textarea
                  placeholder="Optional: Tell us why you're blocking this person..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="resize-none"
                  rows={3}
                />
              </motion.div>
            ) : (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setShowReasonInput(true)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors underline"
              >
                Add a reason (optional)
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1 gap-2"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            <UserX className="w-4 h-4" />
            {isLoading ? "Blocking..." : "Block"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
