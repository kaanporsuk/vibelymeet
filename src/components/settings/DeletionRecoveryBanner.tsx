import { format } from "date-fns";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface DeletionRecoveryBannerProps {
  scheduledDate: string;
  onCancel: () => void;
  isCancelling: boolean;
}

export const DeletionRecoveryBanner = ({
  scheduledDate,
  onCancel,
  isCancelling,
}: DeletionRecoveryBannerProps) => {
  const formattedDate = format(new Date(scheduledDate), "MMMM d, yyyy");

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mt-4 p-4 rounded-xl border border-destructive/30 bg-destructive/10"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium text-foreground">
            Your account is scheduled for deletion on {formattedDate}.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={onCancel}
            disabled={isCancelling}
          >
            {isCancelling ? (
              <>
                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                Cancelling...
              </>
            ) : (
              "Cancel Deletion"
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
