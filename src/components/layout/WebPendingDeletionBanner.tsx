import { useAuth } from "@/contexts/AuthContext";
import { DeletionRecoveryBanner } from "@/components/settings/DeletionRecoveryBanner";
import { useDeletionRecovery } from "@/hooks/useDeletionRecovery";
import { useLocation } from "react-router-dom";

/** Pending account deletion — shown once for the authenticated web shell (all protected routes). */
export function WebPendingDeletionBanner() {
  const location = useLocation();
  const { isAuthenticated, entryState } = useAuth();
  const { pendingDeletion, cancelDeletion, isCancelling } = useDeletionRecovery();

  const suppressForDeletionRecovery =
    location.pathname === "/entry-recovery" && entryState?.state === "deletion_requested";

  if (!isAuthenticated || !pendingDeletion || suppressForDeletionRecovery) return null;

  return (
    <DeletionRecoveryBanner
      scheduledDate={pendingDeletion.scheduled_deletion_at}
      onCancel={cancelDeletion}
      isCancelling={isCancelling}
    />
  );
}
