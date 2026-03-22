import { useState } from 'react';
import { Droplet, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function AdminDailyDropCard() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
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

  const runGenerate = async (force: boolean) => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-daily-drops', {
        body: force ? { force: true } : {},
      });
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
      setOverrideOpen(false);
    }
  };

  const onGenerateClick = () => {
    if (todayCount > 0) {
      setOverrideOpen(true);
      return;
    }
    void runGenerate(false);
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

      <p className="text-xs text-muted-foreground rounded-lg bg-secondary/30 px-3 py-2">
        Auto-generation: daily at 6:00 PM UTC (pg_cron → Edge Function when configured). Set{' '}
        <code className="text-[10px]">app.supabase_url</code> and <code className="text-[10px]">app.cron_secret</code> on
        the database — see migration <code className="text-[10px]">20260322200000_daily_drop_cron.sql</code>.
      </p>

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

      <Button variant="gradient" className="w-full gap-2" disabled={isGenerating} onClick={onGenerateClick}>
        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Droplet className="w-4 h-4" />}
        {todayCount > 0 ? "Generate again (override)" : "Generate today's drops"}
      </Button>

      <AlertDialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate today&apos;s drops?</AlertDialogTitle>
            <AlertDialogDescription>
              {todayCount} pair(s) already exist for today. Continuing will delete all of today&apos;s daily drops and run
              pairing again (admin only).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runGenerate(true)}>Delete today &amp; regenerate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
