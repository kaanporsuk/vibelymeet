import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type ActionType = 
  | 'suspend_user' 
  | 'warn_user' 
  | 'ban_user' 
  | 'review_report' 
  | 'create_event' 
  | 'edit_event' 
  | 'delete_event' 
  | 'lift_suspension';

type TargetType = 'user' | 'report' | 'event';

interface LogActivityParams {
  actionType: ActionType;
  targetType: TargetType;
  targetId?: string;
  details?: Record<string, any>;
}

export const useAdminActivityLog = () => {
  const queryClient = useQueryClient();

  const logActivity = useMutation({
    mutationFn: async ({ actionType, targetType, targetId, details }: LogActivityParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('admin_activity_logs')
        .insert({
          admin_id: user.id,
          action_type: actionType,
          target_type: targetType,
          target_id: targetId,
          details,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-activity-logs'] });
    },
  });

  return {
    logActivity: logActivity.mutateAsync,
    isLogging: logActivity.isPending,
  };
};