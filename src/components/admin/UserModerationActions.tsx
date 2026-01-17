import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Ban,
  AlertTriangle,
  Key,
  Shield,
  ShieldOff,
  Clock,
  X,
  Send,
  History,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { toast } from "sonner";

interface UserModerationActionsProps {
  userId: string;
  userName: string;
  isOpen: boolean;
  onClose: () => void;
}

const UserModerationActions = ({
  userId,
  userName,
  isOpen,
  onClose,
}: UserModerationActionsProps) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("actions");
  
  // Suspend form state
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendDuration, setSuspendDuration] = useState<string>("permanent");
  
  // Warning form state
  const [warningReason, setWarningReason] = useState("");
  const [warningMessage, setWarningMessage] = useState("");

  // Fetch current suspension status
  const { data: currentSuspension } = useQuery({
    queryKey: ['user-suspension', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_suspensions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .single();
      return data;
    },
  });

  // Fetch suspension history
  const { data: suspensionHistory } = useQuery({
    queryKey: ['user-suspension-history', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_suspensions')
        .select('*')
        .eq('user_id', userId)
        .order('suspended_at', { ascending: false });
      return data || [];
    },
  });

  // Fetch warning history
  const { data: warningHistory } = useQuery({
    queryKey: ['user-warning-history', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_warnings')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      return data || [];
    },
  });

  // Suspend user mutation
  const suspendUser = useMutation({
    mutationFn: async () => {
      const expiresAt = suspendDuration === 'permanent' 
        ? null 
        : new Date(Date.now() + parseInt(suspendDuration) * 24 * 60 * 60 * 1000).toISOString();

      // Create suspension record
      const { error: suspensionError } = await supabase
        .from('user_suspensions')
        .insert({
          user_id: userId,
          suspended_by: user?.id,
          reason: suspendReason,
          expires_at: expiresAt,
          status: 'active',
        });
      if (suspensionError) throw suspensionError;

      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ 
          is_suspended: true,
          suspension_reason: suspendReason 
        })
        .eq('id', userId);
      if (profileError) throw profileError;

      // Create admin notification
      await supabase.from('admin_notifications').insert({
        type: 'user_suspended',
        title: 'User Suspended',
        message: `User "${userName}" has been suspended. Reason: ${suspendReason}`,
        data: { user_id: userId, reason: suspendReason },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-suspension', userId] });
      queryClient.invalidateQueries({ queryKey: ['user-suspension-history', userId] });
      queryClient.invalidateQueries({ queryKey: ['admin-user-detail', userId] });
      toast.success(`${userName} has been suspended`);
      setSuspendReason("");
      setSuspendDuration("permanent");
    },
    onError: (error) => {
      toast.error('Failed to suspend user');
      console.error(error);
    },
  });

  // Lift suspension mutation
  const liftSuspension = useMutation({
    mutationFn: async () => {
      if (!currentSuspension) return;

      const { error: suspensionError } = await supabase
        .from('user_suspensions')
        .update({ 
          status: 'lifted',
          lifted_at: new Date().toISOString(),
          lifted_by: user?.id,
        })
        .eq('id', currentSuspension.id);
      if (suspensionError) throw suspensionError;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ 
          is_suspended: false,
          suspension_reason: null 
        })
        .eq('id', userId);
      if (profileError) throw profileError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-suspension', userId] });
      queryClient.invalidateQueries({ queryKey: ['user-suspension-history', userId] });
      queryClient.invalidateQueries({ queryKey: ['admin-user-detail', userId] });
      toast.success(`Suspension lifted for ${userName}`);
    },
    onError: () => {
      toast.error('Failed to lift suspension');
    },
  });

  // Send warning mutation
  const sendWarning = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('user_warnings')
        .insert({
          user_id: userId,
          issued_by: user?.id,
          reason: warningReason,
          message: warningMessage,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-warning-history', userId] });
      toast.success(`Warning sent to ${userName}`);
      setWarningReason("");
      setWarningMessage("");
    },
    onError: () => {
      toast.error('Failed to send warning');
    },
  });

  // Reset password (sends reset email via Supabase)
  const resetPassword = useMutation({
    mutationFn: async () => {
      // Get user email from profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('verified_email')
        .eq('id', userId)
        .single();

      if (!profile?.verified_email) {
        throw new Error('User has no verified email');
      }

      // Note: This requires the user's email. In a real scenario, 
      // you'd use Supabase Admin API via edge function
      toast.info('Password reset functionality requires Supabase Admin API');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reset password');
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
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
                onClick={() => liftSuspension.mutate()}
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
                      onClick={() => suspendUser.mutate()}
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
                    onClick={() => sendWarning.mutate()}
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
                  Send a password reset email to the user's registered email address.
                </p>
                <Button
                  variant="outline"
                  onClick={() => resetPassword.mutate()}
                  disabled={resetPassword.isPending}
                  className="w-full gap-2"
                >
                  <Key className="w-4 h-4" />
                  Send Password Reset Email
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
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UserModerationActions;
