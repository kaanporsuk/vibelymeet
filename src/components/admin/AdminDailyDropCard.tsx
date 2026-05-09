import { useEffect, useState } from 'react';
import { AlertTriangle, Droplet, Loader2 } from 'lucide-react';
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
import {
  formatAdminUtcDateTime,
  type AdminOverviewDailyDropLastRun,
  useAdminOverviewDashboard,
} from '@/hooks/useAdminOverviewDashboard';

function runStatusClass(status: AdminOverviewDailyDropLastRun['status'] | undefined) {
  if (status === 'failed' || status === 'partial') {
    return 'border-destructive/40 bg-destructive/10 text-destructive';
  }
  if (status === 'skipped') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  }
  if (status === 'succeeded') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  return 'border-border/50 bg-secondary/30 text-muted-foreground';
}

function parseAdminDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getTodayBatchCutoffUtc(todayDateUtc: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayDateUtc ?? '');
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 18, 0, 0, 0));
}

export default function AdminDailyDropCard() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const {
    data: overview,
    error,
    isError,
    isLoading,
    refetch,
  } = useAdminOverviewDashboard();

  const dailyDrop = overview?.daily_drop ?? null;
  const todayCount = dailyDrop?.today_pairs;
  const hasReliableStatus = typeof todayCount === 'number';
  const lastRun = dailyDrop?.last_run ?? null;
  const lastRunDayUtc = lastRun?.started_at ? lastRun.started_at.slice(0, 10) : null;
  const hasRunToday = Boolean(dailyDrop?.today_date_utc && lastRunDayUtc === dailyDrop.today_date_utc);
  const generatedAt = parseAdminDate(overview?.generated_at);
  const todayBatchCutoffUtc = getTodayBatchCutoffUtc(dailyDrop?.today_date_utc);
  const isBeforeTodayBatch = Boolean(generatedAt && todayBatchCutoffUtc && generatedAt < todayBatchCutoffUtc);
  const lastRunStartedAt = parseAdminDate(lastRun?.started_at);
  const startedRunAgeMinutes = generatedAt && lastRunStartedAt
    ? (generatedAt.getTime() - lastRunStartedAt.getTime()) / 60_000
    : null;
  const startedRunLooksStale = lastRun?.status === 'started' && (startedRunAgeMinutes == null || startedRunAgeMinutes > 15);
  const latestRunFailed = lastRun?.status === 'failed' || lastRun?.status === 'partial';
  const missingTodayRunAfterSchedule = !lastRun
    ? !isBeforeTodayBatch
    : !hasRunToday && !isBeforeTodayBatch;
  const showRunWarning =
    !isLoading &&
    hasReliableStatus &&
    (missingTodayRunAfterSchedule || latestRunFailed || startedRunLooksStale);
  const runWarningCopy = !lastRun
    ? 'No Daily Drop generation run has been recorded yet.'
    : !hasRunToday
      ? `No generation run recorded for ${dailyDrop?.today_date_utc ?? 'today'} UTC.`
      : startedRunLooksStale
        ? 'The latest generation run is still marked started and may need investigation.'
      : lastRun.status === 'failed' || lastRun.status === 'partial'
        ? (lastRun.error || lastRun.reason || 'The latest generation run did not complete cleanly.')
        : null;
  const runWarningClass = !lastRun || !hasRunToday || startedRunLooksStale
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    : runStatusClass(lastRun.status);

  const runGenerate = async (force: boolean) => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-daily-drops', {
        body: force ? { force: true } : {},
      });
      if (error) throw error;

      if (data?.success) {
        const notificationFailures = Number(data?.notification_failures ?? 0);
        const message = `Generated ${data.pairs_created} pairs, notified ${data.users_notified} users`;
        if (notificationFailures > 0) {
          toast.warning(`${message}, ${notificationFailures} notification failure${notificationFailures === 1 ? '' : 's'}`);
        } else {
          toast.success(message);
        }
      } else if (data?.error === 'insert_failed' || data?.error === 'insert_partial') {
        toast.error(data?.details || data?.error || 'Insert failed');
      } else {
        toast.info(data?.reason || data?.error || 'No drops generated');
      }
      void refetch();
    } catch (err) {
      toast.error('Failed to generate drops');
      console.error(err);
    } finally {
      setIsGenerating(false);
      setOverrideOpen(false);
    }
  };

  const onGenerateClick = () => {
    setOverrideOpen(true);
  };

  useEffect(() => {
    const channel = supabase
      .channel('admin-daily-drop-runs')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'daily_drop_generation_runs' },
        () => { void refetch(); },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'daily_drop_generation_runs' },
        () => { void refetch(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refetch]);

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
        Auto-generation: daily at 6:00 PM UTC (pg_cron to Edge Function). The canonical schedule reads Vault secrets{' '}
        <code className="text-[10px]">project_url</code> and{' '}
        <code className="text-[10px]">date_suggestion_cron_secret</code>; see migrations{' '}
        <code className="text-[10px]">20260322200100_daily_drop_cron.sql</code> and{' '}
        <code className="text-[10px]">20260509210000_daily_drop_cron_observability.sql</code>.
      </p>

      {isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Unable to load Daily Drop status</p>
            <p>{error?.message || "Backend overview read failed."}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <div className="p-3 rounded-xl bg-secondary/30">
          <p className="text-muted-foreground text-xs">
            Today{dailyDrop?.today_date_utc ? ` (${dailyDrop.today_date_utc} UTC)` : ''}
          </p>
          <p className="text-lg font-bold text-foreground">
            {isLoading ? 'Loading' : hasReliableStatus ? `${todayCount} pairs` : 'Unavailable'}
          </p>
        </div>
        <div className="p-3 rounded-xl bg-secondary/30">
          <p className="text-muted-foreground text-xs">Last pair generated (UTC)</p>
          <p className="text-sm font-medium text-foreground">
            {isLoading ? 'Loading' : formatAdminUtcDateTime(dailyDrop?.last_generated_at)}
          </p>
        </div>
        <div className="p-3 rounded-xl bg-secondary/30">
          <p className="text-muted-foreground text-xs">Last job run (UTC)</p>
          <p className="text-sm font-medium text-foreground">
            {isLoading ? 'Loading' : formatAdminUtcDateTime(lastRun?.started_at)}
          </p>
          {!isLoading && lastRun && (
            <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${runStatusClass(lastRun.status)}`}>
              {lastRun.status}
              {lastRun.source !== 'unknown' ? ` via ${lastRun.source}` : ''}
            </span>
          )}
        </div>
      </div>

      {showRunWarning && runWarningCopy && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${runWarningClass}`}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p>{runWarningCopy}</p>
          </div>
        </div>
      )}

      <Button
        variant="gradient"
        className="w-full gap-2"
        disabled={isGenerating || !hasReliableStatus}
        onClick={onGenerateClick}
      >
        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Droplet className="w-4 h-4" />}
        {!hasReliableStatus ? "Daily Drop status unavailable" : todayCount > 0 ? "Generate again (override)" : "Generate today's drops"}
      </Button>

      <AlertDialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {(todayCount ?? 0) > 0 ? "Regenerate today's drops?" : "Generate today's drops?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(todayCount ?? 0) > 0
                ? `${todayCount} pair(s) already exist for today. Continuing will delete all of today's daily drops and run pairing again.`
                : "This calls generate-daily-drops and can create production daily-drop pairs and notify users."}
              {" "}This is an immediate admin-only production action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runGenerate((todayCount ?? 0) > 0)}>
              {(todayCount ?? 0) > 0 ? "Delete today & regenerate" : "Generate Drops"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
