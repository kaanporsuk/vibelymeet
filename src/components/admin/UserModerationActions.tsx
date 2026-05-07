import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  AlertTriangle,
  Key,
  Shield,
  ShieldOff,
  Send,
  History,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { toast } from "sonner";
import AdminConfirmDialog from "./AdminConfirmDialog";
import { callAdminRpc, createAdminIdempotencyKey } from "@/lib/adminRpc";

export type AdminSuspensionRow = {
  id: string;
  user_id?: string | null;
  suspended_by?: string | null;
  reason: string | null;
  suspended_at: string;
  expires_at: string | null;
  lifted_at: string | null;
  lifted_by?: string | null;
  status: string;
};

export type AdminWarningRow = {
  id: string;
  user_id?: string | null;
  issued_by?: string | null;
  reason: string;
  message: string;
  acknowledged_at: string | null;
  created_at: string;
};

export type AdminModerationReadModel = {
  current_suspension?: AdminSuspensionRow | null;
  suspension_history?: AdminSuspensionRow[];
  warning_history?: AdminWarningRow[];
};

interface UserModerationActionsProps {
  userId: string;
  userName: string;
  moderation?: AdminModerationReadModel | null;
  isOpen: boolean;
  onClose: () => void;
}

const UserModerationActions = ({
  userId,
  userName,
  moderation,
  isOpen,
  onClose,
}: UserModerationActionsProps) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("actions");

  // Suspend form state
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendDuration, setSuspendDuration] = useState<string>("permanent");

  // Warning form state
  const [warningReason, setWarningReason] = useState("");
  const [warningMessage, setWarningMessage] = useState("");
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void | Promise<unknown>;
  } | null>(null);

  const currentSuspension = moderation?.current_suspension ?? null;
  const suspensionHistory = moderation?.suspension_history ?? [];
  const warningHistory = moderation?.warning_history ?? [];

  // Suspend user mutation
  const suspendUser = useMutation({
    mutationFn: async () => {
      const expiresAt = suspendDuration === 'permanent'
        ? null
        : new Date(Date.now() + parseInt(suspendDuration) * 24 * 60 * 60 * 1000).toISOString();

      await callAdminRpc("admin_moderate_user", {
        p_user_id: userId,
        p_action: "suspend_user",
        p_reason: suspendReason,
        p_message: null,
        p_suspension_expires_at: expiresAt,
        p_idempotency_key: createAdminIdempotencyKey("admin_moderate_user"),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-user-detail', userId] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success(`${userName} has been suspended`);
      setSuspendReason("");
      setSuspendDuration("permanent");
    },
    onError: () => {
      toast.error('Failed to suspend user');
    },
  });

  // Lift suspension mutation
  const liftSuspension = useMutation({
    mutationFn: async () => {
      if (!currentSuspension) return;

      await callAdminRpc("admin_moderate_user", {
        p_user_id: userId,
        p_action: "lift_suspension",
        p_reason: "Lift active suspension",
        p_message: null,
        p_suspension_expires_at: null,
        p_idempotency_key: createAdminIdempotencyKey("admin_moderate_user"),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-user-detail', userId] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success(`Suspension lifted for ${userName}`);
    },
    onError: () => {
      toast.error('Failed to lift suspension');
    },
  });

  // Send warning mutation
  const sendWarning = useMutation({
    mutationFn: async () => {
      await callAdminRpc("admin_moderate_user", {
        p_user_id: userId,
        p_action: "issue_warning",
        p_reason: warningReason,
        p_message: warningMessage,
        p_suspension_expires_at: null,
        p_idempotency_key: createAdminIdempotencyKey("admin_moderate_user"),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-user-detail', userId] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success(`Warning sent to ${userName}`);
      setWarningReason("");
      setWarningMessage("");
    },
    onError: () => {
      toast.error('Failed to send warning');
    },
  });

  const moderationPending = suspendUser.isPending || liftSuspension.isPending || sendWarning.isPending;
  const suspensionDurationLabel = suspendDuration === "permanent" ? "permanent" : `${suspendDuration} day${suspendDuration === "1" ? "" : "s"}`;
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setConfirmation(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Moderate User: {userName}
          </DialogTitle>
          <DialogDescription>
            Manage user access, send warnings, and view moderation history
          </DialogDescription>
        </DialogHeader>

        {/* Current Status */}
        {currentSuspension && (
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ban className="w-5 h-5 text-destructive" />
                <span className="font-medium text-destructive">Currently Suspended</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setConfirmation({
                    title: `Lift suspension for ${userName}?`,
                    description: "This calls the backend admin_moderate_user RPC. The active suspension row, profile state, and admin audit row commit together or fail together.",
                    confirmLabel: "Lift Suspension",
                    onConfirm: () => liftSuspension.mutateAsync(),
                  });
                }}
                disabled={liftSuspension.isPending}
                className="gap-2"
              >
                <ShieldOff className="w-4 h-4" />
                Lift Suspension
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Reason: {currentSuspension.reason}
            </p>
            {currentSuspension.expires_at && (
              <p className="text-xs text-muted-foreground mt-1">
                Expires: {format(new Date(currentSuspension.expires_at), 'PPp')}
              </p>
            )}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="w-full bg-secondary/50">
            <TabsTrigger value="actions" className="flex-1">Actions</TabsTrigger>
            <TabsTrigger value="history" className="flex-1">History</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            <TabsContent value="actions" className="space-y-6 m-0">
              {/* Suspend User */}
              {!currentSuspension && (
                <div className="space-y-4 p-4 border border-border rounded-xl">
                  <div className="flex items-center gap-2">
                    <Ban className="w-5 h-5 text-destructive" />
                    <h3 className="font-semibold text-foreground">Suspend User</h3>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <Label>Suspension Duration</Label>
                      <Select value={suspendDuration} onValueChange={setSuspendDuration}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 Day</SelectItem>
                          <SelectItem value="3">3 Days</SelectItem>
                          <SelectItem value="7">1 Week</SelectItem>
                          <SelectItem value="14">2 Weeks</SelectItem>
                          <SelectItem value="30">1 Month</SelectItem>
                          <SelectItem value="permanent">Permanent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Reason</Label>
                      <Textarea
                        value={suspendReason}
                        onChange={(e) => setSuspendReason(e.target.value)}
                        placeholder="Describe the reason for suspension..."
                        className="mt-1"
                        rows={3}
                      />
                    </div>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setConfirmation({
                          title: `Suspend ${userName}?`,
                          description: `This will immediately restrict this user's account access.\n\nDuration: ${suspensionDurationLabel}\nReason: ${suspendReason.trim()}`,
                          confirmLabel: "Suspend User",
                          onConfirm: () => suspendUser.mutateAsync(),
                        });
                      }}
                      disabled={!suspendReason.trim() || suspendUser.isPending}
                      className="w-full gap-2"
                    >
                      <Ban className="w-4 h-4" />
                      Suspend User
                    </Button>
                  </div>
                </div>
              )}

              {/* Send Warning */}
              <div className="space-y-4 p-4 border border-border rounded-xl">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-500" />
                  <h3 className="font-semibold text-foreground">Send Warning</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label>Reason</Label>
                    <Select value={warningReason} onValueChange={setWarningReason}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select reason..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inappropriate_content">Inappropriate Content</SelectItem>
                        <SelectItem value="harassment">Harassment</SelectItem>
                        <SelectItem value="fake_profile">Fake Profile Suspicion</SelectItem>
                        <SelectItem value="spam">Spam Behavior</SelectItem>
                        <SelectItem value="terms_violation">Terms Violation</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Message to User</Label>
                    <Textarea
                      value={warningMessage}
                      onChange={(e) => setWarningMessage(e.target.value)}
                      placeholder="Write a message to the user explaining the warning..."
                      className="mt-1"
                      rows={3}
                    />
                  </div>
                  <Button
                    onClick={() => {
                      setConfirmation({
                        title: `Send warning to ${userName}?`,
                        description: `This creates a user-visible warning record.\n\nReason: ${warningReason.replace("_", " ")}\nMessage: ${warningMessage.trim()}`,
                        confirmLabel: "Send Warning",
                        onConfirm: () => sendWarning.mutateAsync(),
                      });
                    }}
                    disabled={!warningReason || !warningMessage.trim() || sendWarning.isPending}
                    className="w-full gap-2 bg-yellow-500 hover:bg-yellow-600"
                  >
                    <Send className="w-4 h-4" />
                    Send Warning
                  </Button>
                </div>
              </div>

              {/* Reset Password */}
              <div className="space-y-4 p-4 border border-border rounded-xl">
                <div className="flex items-center gap-2">
                  <Key className="w-5 h-5 text-cyan-400" />
                  <h3 className="font-semibold text-foreground">Reset Password</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Unavailable — requires backend Admin API support.
                </p>
                <Button
                  variant="outline"
                  disabled
                  className="w-full gap-2"
                >
                  <Key className="w-4 h-4" />
                  Unavailable — requires backend Admin API support
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="history" className="space-y-6 m-0">
              {/* Suspension History */}
              <div className="space-y-3">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <History className="w-4 h-4" />
                  Suspension History ({suspensionHistory?.length || 0})
                </h3>
                {suspensionHistory?.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No suspensions on record</p>
                ) : (
                  suspensionHistory?.map((suspension) => (
                    <div
                      key={suspension.id}
                      className={`p-3 rounded-xl border ${
                        suspension.status === 'active'
                          ? 'bg-destructive/10 border-destructive/30'
                          : 'bg-secondary/30 border-border'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Badge
                          variant={suspension.status === 'active' ? 'destructive' : 'secondary'}
                        >
                          {suspension.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(suspension.suspended_at), 'PPp')}
                        </span>
                      </div>
                      <p className="text-sm text-foreground">{suspension.reason}</p>
                      {suspension.expires_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {suspension.status === 'active' ? 'Expires' : 'Was set to expire'}:{' '}
                          {format(new Date(suspension.expires_at), 'PPp')}
                        </p>
                      )}
                      {suspension.lifted_at && (
                        <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Lifted: {format(new Date(suspension.lifted_at), 'PPp')}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Warning History */}
              <div className="space-y-3">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Warning History ({warningHistory?.length || 0})
                </h3>
                {warningHistory?.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No warnings on record</p>
                ) : (
                  warningHistory?.map((warning) => (
                    <div
                      key={warning.id}
                      className="p-3 rounded-xl border bg-yellow-500/10 border-yellow-500/30"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline" className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">
                          {warning.reason.replace('_', ' ')}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(warning.created_at), 'PPp')}
                        </span>
                      </div>
                      <p className="text-sm text-foreground">{warning.message}</p>
                      {warning.acknowledged_at && (
                        <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Acknowledged: {format(new Date(warning.acknowledged_at), 'PPp')}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
        <AdminConfirmDialog
          open={!!confirmation}
          title={confirmation?.title ?? ""}
          description={confirmation?.description ?? ""}
          confirmLabel={confirmation?.confirmLabel ?? "Confirm"}
          isPending={moderationPending}
          onOpenChange={(open) => {
            if (!open) setConfirmation(null);
          }}
          onConfirm={() => confirmation?.onConfirm()}
        />
      </DialogContent>
    </Dialog>
  );
};

export default UserModerationActions;
