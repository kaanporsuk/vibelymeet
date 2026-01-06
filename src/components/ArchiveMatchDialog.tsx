import { Archive, MessageSquare } from "lucide-react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ArchiveMatchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  userName: string;
  userAvatar?: string;
  isLoading?: boolean;
}

export const ArchiveMatchDialog = ({
  isOpen,
  onClose,
  onConfirm,
  userName,
  userAvatar,
  isLoading,
}: ArchiveMatchDialogProps) => {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader className="text-center pb-2">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-16 h-16 mx-auto mb-4 rounded-full bg-secondary flex items-center justify-center"
          >
            {userAvatar ? (
              <div className="relative">
                <img
                  src={userAvatar}
                  alt={userName}
                  className="w-14 h-14 rounded-full object-cover"
                />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                  <Archive className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
            ) : (
              <Archive className="w-8 h-8 text-muted-foreground" />
            )}
          </motion.div>
          <DialogTitle className="text-xl font-display">
            Archive {userName}?
          </DialogTitle>
          <DialogDescription className="text-muted-foreground pt-2">
            This conversation will be hidden from your main matches list. You can find it in archived matches anytime.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 p-3 rounded-xl bg-primary/5 border border-primary/10 my-4">
          <MessageSquare className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            You'll still be matched and can continue the conversation. {userName} won't be notified.
          </p>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="secondary"
            className="flex-1 gap-2"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            <Archive className="w-4 h-4" />
            {isLoading ? "Archiving..." : "Archive"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
