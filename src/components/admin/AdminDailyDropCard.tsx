import { useState } from 'react';
import { Droplet, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function AdminDailyDropCard() {
  const [isGenerating, setIsGenerating] = useState(false);
  const today = new Date().toISOString().split('T')[0];

  const { data: todayCount = 0, refetch } = useQuery({
    queryKey: ['admin-daily-drops-today'],
    queryFn: async () => {
      const { count } = await supabase
        .from('daily_drops')
        .select('id', { count: 'exact', head: true })
        .eq('drop_date', today);
      return count || 0;
    },
    refetchInterval: 30000,
  });

  const { data: lastGenerated } = useQuery({
    queryKey: ['admin-daily-drops-last'],
    queryFn: async () => {
      const { data } = await supabase
        .from('daily_drops')
        .select('starts_at')
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.starts_at ?? null;
    },
  });

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-daily-drops');
      if (error) throw error;

      if (data?.success) {
        toast.success(`Generated ${data.pairs_created} pairs, notified ${data.users_notified} users`);
      } else {
        toast.info(data?.reason || 'No drops generated');
      }
      refetch();
    } catch (err) {
      toast.error('Failed to generate drops');
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="glass-card p-6 rounded-2xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
          <Droplet className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Daily Drop</h3>
          <p className="text-xs text-muted-foreground">Mutual match generation</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="p-3 rounded-xl bg-secondary/30">
          <p className="text-muted-foreground text-xs">Today</p>
          <p className="text-lg font-bold text-foreground">{todayCount} pairs</p>
        </div>
        <div className="p-3 rounded-xl bg-secondary/30">
          <p className="text-muted-foreground text-xs">Last generated</p>
          <p className="text-sm font-medium text-foreground">
            {lastGenerated ? format(new Date(lastGenerated), 'MMM d, h:mm a') : 'Never'}
          </p>
        </div>
      </div>

      <Button
        variant="gradient"
        className="w-full gap-2"
        disabled={todayCount > 0 || isGenerating}
        onClick={handleGenerate}
      >
        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Droplet className="w-4 h-4" />}
        {todayCount > 0 ? "Today's Drops Generated" : "Generate Today's Drops"}
      </Button>
    </div>
  );
}
