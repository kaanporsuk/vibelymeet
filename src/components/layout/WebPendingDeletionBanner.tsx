import { useAuth } from "@/contexts/AuthContext";
import { DeletionRecoveryBanner } from "@/components/settings/DeletionRecoveryBanner";
import { useDeletionRecovery } from "@/hooks/useDeletionRecovery";

/** Pending account deletion — shown once for the authenticated web shell (all protected routes). */
export function WebPendingDeletionBanner() {
  const { isAuthenticated } = useAuth();
  const { pendingDeletion, cancelDeletion, isCancelling } = useDeletionRecovery();

  if (!isAuthenticated || !pendingDeletion) return null;

  return (
    <DeletionRecoveryBanner
      scheduledDate={pendingDeletion.scheduled_deletion_at}
      onCancel={cancelDeletion}
      isCancelling={isCancelling}
    />
  );
}
