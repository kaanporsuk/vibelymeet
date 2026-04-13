import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type OwnedFamily = "vibe_video" | "profile_photo" | "event_cover";
type ChatMode = "retain_until_eligible" | "soft_delete" | "immediate";

type SettingsRow = {
  media_family: string;
  retention_mode: ChatMode | "soft_delete";
  retention_days: number | null;
  eligible_days: number | null;
  worker_enabled: boolean;
  dry_run: boolean;
  batch_size: number;
  max_attempts: number;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
};

type CountRow = {
  media_family: string;
  status: string;
  job_type?: string | null;
  count: number;
};

type OrphanRow = {
  bucket: string;
  media_family: string;
  count: number;
};

type CronJobInfo = {
  job_id: number;
  jobname: string;
  schedule: string;
  active: boolean;
  last_succeeded_at: string | null;
  last_failed_at: string | null;
  consecutive_failures: number;
};

type CronRun = {
  runid: number;
  status: string;
  start_time: string;
  end_time: string | null;
  duration_ms: number | null;
};

type FailedJob = {
  id: string;
  asset_id: string;
  media_family: string;
  provider: string;
  provider_path: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  next_attempt_at: string;
};

type StaleJob = {
  id: string;
  asset_id: string;
  media_family: string;
  provider: string;
  provider_path: string | null;
  attempts: number;
  started_at: string;
  worker_id: string | null;
};

type OpsHealth = {
  healthy: boolean;
  asset_counts: Record<string, number>;
  job_counts: Record<string, number>;
  failed_count: number;
  abandoned_count: number;
  stale_claimed_count: number;
  promotable_now: number;
  pending_jobs: number;
  disabled_families: string[];
  snapshot_at: string;
};

type SnapshotPayload = {
  settings: {
    owned_media: SettingsRow[];
    chat_policy: {
      consistent: boolean;
      retention_mode: ChatMode | "mixed" | null;
      eligible_days: number | null;
      worker_enabled: boolean | null;
      families: SettingsRow[];
    };
    verification_selfie: SettingsRow | null;
  };
  readiness: {
    asset_status_counts: CountRow[];
    job_status_counts: CountRow[];
    orphan_like_counts: OrphanRow[];
    would_process_now: {
      promotable_assets: number;
      queued_jobs: number;
      total_candidates: number;
      by_family: Array<{
        media_family: string;
        promotable_assets: number;
        queued_jobs: number;
        total_candidates: number;
      }>;
      explanation: string;
    };
    failed_job_total: number;
    orphan_like_total: number;
    notes: string[];
  };
  recommended_activation: {
    verdict: string;
    initial_batch_size: number;
    initial_cadence: string;
    retry_behavior: string;
    initial_family_filter: string[] | null;
    rollback: string[];
    rationale: string;
  };
  ops: {
    health: OpsHealth | null;
    cron_job: CronJobInfo | null;
    recent_runs: CronRun[];
    failed_jobs: FailedJob[];
    stale_claimed_jobs: StaleJob[];
  };
};

type FamilyDraft = {
  retentionDays: string;
  workerEnabled: boolean;
};

const FAMILY_LABELS: Record<OwnedFamily, string> = {
  vibe_video: "Vibe videos",
  profile_photo: "Profile photos",
  event_cover: "Event covers",
};

async function fetchSnapshot(): Promise<SnapshotPayload> {
  const { data, error } = await supabase.functions.invoke("admin-media-lifecycle-controls", {
    body: { action: "snapshot" },
  });
  if (error || !data?.success) {
    throw new Error(data?.error || error?.message || "Failed to load media lifecycle controls");
  }
  return data as SnapshotPayload & { success: true };
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function CronStatusCard({ cronJob, recentRuns }: { cronJob: CronJobInfo | null; recentRuns: CronRun[] }) {
  if (!cronJob) {
    return (
      <Card className="glass-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Timer className="h-4 w-4 text-muted-foreground" />
            Cron scheduler
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Job not found.</CardContent>
      </Card>
    );
  }

  const lastRun = recentRuns[0] ?? null;

  return (
    <Card className="glass-card border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Timer className="h-4 w-4 text-primary" />
          Cron scheduler
        </CardTitle>
        <CardDescription>{cronJob.jobname} · job #{cronJob.job_id}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Schedule</span>
          <code className="text-xs bg-secondary/50 px-1.5 py-0.5 rounded">{cronJob.schedule}</code>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Status</span>
          <Badge variant="outline" className={cronJob.active ? "border-emerald-500/40 text-emerald-500" : "border-amber-500/40 text-amber-500"}>
            {cronJob.active ? "active" : "paused"}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Last succeeded</span>
          <span className="font-medium">{formatRelative(cronJob.last_succeeded_at)}</span>
        </div>
        {cronJob.consecutive_failures > 0 && (
          <div className="flex items-center justify-between text-destructive">
            <span>Consecutive failures</span>
            <span className="font-semibold">{cronJob.consecutive_failures}</span>
          </div>
        )}
        {lastRun && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Last run</span>
            <div className="flex items-center gap-1.5">
              {lastRun.status === "succeeded"
                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                : <XCircle className="h-3.5 w-3.5 text-destructive" />}
              <span className="text-xs">{formatRelative(lastRun.start_time)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentRunsCard({ runs }: { runs: CronRun[] }) {
  if (!runs.length) return null;

  return (
    <Card className="glass-card border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-primary" />
          Recent worker runs
        </CardTitle>
        <CardDescription>Last {runs.length} scheduled executions.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {runs.map((run) => (
            <div key={run.runid} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-secondary/20">
              <div className="flex items-center gap-2">
                {run.status === "succeeded"
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                <span className="text-muted-foreground">{formatRelative(run.start_time)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {run.duration_ms != null && <span>{run.duration_ms}ms</span>}
                <Badge variant="secondary" className="text-xs py-0">{run.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FailedJobsSection({
  jobs,
  onRetryAll,
  onRetryFamily,
  isPending,
}: {
  jobs: FailedJob[];
  onRetryAll: () => void;
  onRetryFamily: (family: string) => void;
  isPending: boolean;
}) {
  if (!jobs.length) return null;

  const byFamily = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.media_family] = (acc[j.media_family] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card className="glass-card border-destructive/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Failed / abandoned jobs
              <Badge variant="destructive" className="ml-1">{jobs.length}</Badge>
            </CardTitle>
            <CardDescription>These jobs failed all retry attempts or hit the max-attempts limit.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={onRetryAll}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Retry all
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {Object.entries(byFamily).map(([family, count]) => (
            <Button
              key={family}
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs border border-border/50"
              onClick={() => onRetryFamily(family)}
              disabled={isPending}
            >
              <RotateCcw className="h-3 w-3" />
              Retry {family} ({count})
            </Button>
          ))}
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/50">
                <th className="pb-2 pr-3 font-medium">Family</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 pr-3 font-medium">Attempts</th>
                <th className="pb-2 pr-3 font-medium">Error</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-border/20 hover:bg-secondary/10">
                  <td className="py-2 pr-3 font-medium text-foreground">{job.media_family}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={job.status === "abandoned" ? "destructive" : "outline"} className="text-xs py-0">
                      {job.status}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{job.attempts}/{job.max_attempts}</td>
                  <td className="py-2 pr-3 text-muted-foreground max-w-[280px] truncate" title={job.last_error ?? ""}>{job.last_error ?? "—"}</td>
                  <td className="py-2 text-muted-foreground whitespace-nowrap">{formatRelative(job.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function StaleClaimedSection({
  jobs,
  onRequeue,
  isPending,
}: {
  jobs: StaleJob[];
  onRequeue: () => void;
  isPending: boolean;
}) {
  if (!jobs.length) return null;

  return (
    <Card className="glass-card border-amber-500/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2 text-amber-500">
              <AlertTriangle className="h-5 w-5" />
              Stale claimed jobs
              <Badge variant="outline" className="ml-1 border-amber-500/40 text-amber-500">{jobs.length}</Badge>
            </CardTitle>
            <CardDescription>Jobs stuck in `claimed` state for &gt;30 minutes — worker likely crashed mid-run.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
            onClick={onRequeue}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Requeue all stale
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/50">
                <th className="pb-2 pr-3 font-medium">Family</th>
                <th className="pb-2 pr-3 font-medium">Worker</th>
                <th className="pb-2 pr-3 font-medium">Started</th>
                <th className="pb-2 font-medium">Attempts</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-border/20 hover:bg-secondary/10">
                  <td className="py-2 pr-3 font-medium text-foreground">{job.media_family}</td>
                  <td className="py-2 pr-3 text-muted-foreground font-mono text-xs truncate max-w-[160px]">{job.worker_id ?? "—"}</td>
                  <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{formatRelative(job.started_at)}</td>
                  <td className="py-2 text-muted-foreground">{job.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminMediaLifecyclePanel() {
  const qc = useQueryClient();
  const [familyDrafts, setFamilyDrafts] = useState<Record<OwnedFamily, FamilyDraft>>({
    vibe_video: { retentionDays: "30", workerEnabled: true },
    profile_photo: { retentionDays: "30", workerEnabled: true },
    event_cover: { retentionDays: "90", workerEnabled: true },
  });
  const [chatMode, setChatMode] = useState<ChatMode>("retain_until_eligible");
  const [chatEligibleDays, setChatEligibleDays] = useState("0");
  const [chatWorkerEnabled, setChatWorkerEnabled] = useState(true);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-media-lifecycle-controls"],
    queryFn: fetchSnapshot,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!data) return;
    const nextDrafts = { ...familyDrafts };
    for (const row of data.settings.owned_media) {
      if (row.media_family in nextDrafts) {
        nextDrafts[row.media_family as OwnedFamily] = {
          retentionDays: row.retention_days === null ? "" : String(row.retention_days),
          workerEnabled: row.worker_enabled,
        };
      }
    }
    setFamilyDrafts(nextDrafts);
    if (data.settings.chat_policy.retention_mode && data.settings.chat_policy.retention_mode !== "mixed") {
      setChatMode(data.settings.chat_policy.retention_mode);
    }
    setChatEligibleDays(data.settings.chat_policy.eligible_days === null ? "" : String(data.settings.chat_policy.eligible_days));
    setChatWorkerEnabled(data.settings.chat_policy.worker_enabled ?? true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const saveFamilyMutation = useMutation({
    mutationFn: async ({ mediaFamily, draft }: { mediaFamily: OwnedFamily; draft: FamilyDraft }) => {
      const retentionDays = draft.retentionDays === "" ? null : Number(draft.retentionDays);
      if (retentionDays !== null && (!Number.isInteger(retentionDays) || retentionDays < 0)) {
        throw new Error("Retention days must be a non-negative whole number");
      }
      const { data, error } = await supabase.functions.invoke("admin-media-lifecycle-controls", {
        body: { action: "update_family", media_family: mediaFamily, retention_days: retentionDays, worker_enabled: draft.workerEnabled },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "Failed to update setting");
    },
    onSuccess: (_data, variables) => {
      toast.success(`${FAMILY_LABELS[variables.mediaFamily]} updated`);
      void qc.invalidateQueries({ queryKey: ["admin-media-lifecycle-controls"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save media setting"),
  });

  const saveChatMutation = useMutation({
    mutationFn: async () => {
      const eligibleDays = chatEligibleDays === "" ? null : Number(chatEligibleDays);
      if (eligibleDays !== null && (!Number.isInteger(eligibleDays) || eligibleDays < 0)) {
        throw new Error("Eligible days must be a non-negative whole number");
      }
      const { data, error } = await supabase.functions.invoke("admin-media-lifecycle-controls", {
        body: { action: "update_chat_policy", retention_mode: chatMode, eligible_days: eligibleDays, worker_enabled: chatWorkerEnabled },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "Failed to update chat policy");
    },
    onSuccess: () => {
      toast.success("Chat media policy updated");
      void qc.invalidateQueries({ queryKey: ["admin-media-lifecycle-controls"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save chat policy"),
  });

  const retryFailedMutation = useMutation({
    mutationFn: async (family?: string) => {
      const { data, error } = await supabase.functions.invoke("admin-media-lifecycle-controls", {
        body: { action: "retry_failed", family: family ?? null, limit: 50 },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "Retry failed");
      return data as { retried_count: number };
    },
    onSuccess: (result) => {
      toast.success(`Retried ${result.retried_count} failed job${result.retried_count === 1 ? "" : "s"}`);
      void qc.invalidateQueries({ queryKey: ["admin-media-lifecycle-controls"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not retry jobs"),
  });

  const requeueStaleMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-media-lifecycle-controls", {
        body: { action: "requeue_stale", stale_minutes: 30 },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "Requeue failed");
      return data as { requeued_count: number };
    },
    onSuccess: (result) => {
      toast.success(`Requeued ${result.requeued_count} stale job${result.requeued_count === 1 ? "" : "s"}`);
      void qc.invalidateQueries({ queryKey: ["admin-media-lifecycle-controls"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not requeue stale jobs"),
  });

  const assetStatusRows = useMemo(() => data?.readiness.asset_status_counts ?? [], [data]);
  const jobStatusRows = useMemo(() => data?.readiness.job_status_counts ?? [], [data]);
  const verificationSelfie = data?.settings.verification_selfie;
  const opsHealth = data?.ops?.health ?? null;
  const cronJob = data?.ops?.cron_job ?? null;
  const recentRuns = data?.ops?.recent_runs ?? [];
  const failedJobs = data?.ops?.failed_jobs ?? [];
  const staleJobs = data?.ops?.stale_claimed_jobs ?? [];

  const healthOk = opsHealth?.healthy ?? true;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading media lifecycle controls…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-xl font-bold font-display text-foreground">Media lifecycle</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Retention controls, worker observability, and operator recovery tooling. Eligibility rules stay code-owned.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {/* ── Top status row ──────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Health */}
        <Card className="glass-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {healthOk
                ? <ShieldCheck className="h-4 w-4 text-emerald-500" />
                : <AlertTriangle className="h-4 w-4 text-destructive" />}
              System health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant="outline" className={healthOk ? "border-emerald-500/40 text-emerald-500" : "border-destructive/40 text-destructive"}>
                {healthOk ? "healthy" : "needs attention"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Failed/abandoned</span>
              <span className={`font-semibold ${(opsHealth?.failed_count ?? 0) + (opsHealth?.abandoned_count ?? 0) > 0 ? "text-destructive" : ""}`}>
                {(opsHealth?.failed_count ?? 0) + (opsHealth?.abandoned_count ?? 0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Stale claimed</span>
              <span className={`font-semibold ${(opsHealth?.stale_claimed_count ?? 0) > 0 ? "text-amber-500" : ""}`}>
                {opsHealth?.stale_claimed_count ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Promotable now</span>
              <span className="font-semibold">{opsHealth?.promotable_now ?? 0}</span>
            </div>
          </CardContent>
        </Card>

        {/* Cron status */}
        <CronStatusCard cronJob={cronJob} recentRuns={recentRuns} />

        {/* Would process now */}
        <Card className="glass-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" />
              Would process now
            </CardTitle>
            <CardDescription>Read-only preview; no mutations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Promotable assets</span>
              <span className="font-semibold">{data?.readiness.would_process_now.promotable_assets ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Queued jobs ready</span>
              <span className="font-semibold">{data?.readiness.would_process_now.queued_jobs ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total candidates</span>
              <span className="font-semibold">{data?.readiness.would_process_now.total_candidates ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Orphan-like assets</span>
              <span className="font-semibold">{data?.readiness.orphan_like_counts.reduce((s, r) => s + r.count, 0) ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Recent runs ─────────────────────────────────────────────────────── */}
      {recentRuns.length > 0 && <RecentRunsCard runs={recentRuns} />}

      {/* ── Failed jobs (only shown when present) ───────────────────────────── */}
      <FailedJobsSection
        jobs={failedJobs}
        onRetryAll={() => retryFailedMutation.mutate(undefined)}
        onRetryFamily={(family) => retryFailedMutation.mutate(family)}
        isPending={retryFailedMutation.isPending}
      />

      {/* ── Stale claimed jobs (only shown when present) ─────────────────────── */}
      <StaleClaimedSection
        jobs={staleJobs}
        onRequeue={() => requeueStaleMutation.mutate()}
        isPending={requeueStaleMutation.isPending}
      />

      {/* ── Readiness preview ───────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Asset & job state counts</CardTitle>
            <CardDescription>Live counts by family and status. Refreshes every 60s.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {data?.readiness.would_process_now.by_family.length ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Due for processing</p>
                {data.readiness.would_process_now.by_family.map((row) => (
                  <div key={row.media_family} className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/20 px-4 py-2 text-sm">
                    <span className="font-medium text-foreground">{row.media_family}</span>
                    <span className="text-muted-foreground text-xs">{row.promotable_assets} promotable · {row.queued_jobs} queued</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing due for processing right now.</p>
            )}

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Assets by family / status</p>
              {assetStatusRows.map((row) => (
                <div key={`${row.media_family}-${row.status}`} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{row.media_family} · <span className="text-foreground">{row.status}</span></span>
                  <span className="font-medium text-foreground">{row.count}</span>
                </div>
              ))}
            </div>

            {jobStatusRows.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Jobs by family / status</p>
                {jobStatusRows.map((row) => (
                  <div key={`${row.media_family}-${row.status}`} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{row.media_family} · <span className="text-foreground">{row.status}</span></span>
                    <span className="font-medium text-foreground">{row.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Operator notes</CardTitle>
            <CardDescription>Recovery actions and policy guardrails.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-2">
              {data?.recommended_activation.rollback.map((line) => (
                <div key={line} className="rounded-xl border border-border/50 bg-secondary/20 px-4 py-3 text-muted-foreground">
                  {line}
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-border/50 bg-secondary/20 px-4 py-3">
              <p className="font-medium text-foreground mb-1">Retry behavior</p>
              <p className="text-muted-foreground">{data?.recommended_activation.retry_behavior}</p>
            </div>
            <div className="rounded-xl border border-border/50 bg-secondary/20 px-4 py-3">
              <p className="font-medium text-foreground mb-1">Locked policy</p>
              <p className="text-muted-foreground">
                verification_selfie stays worker-disabled (worker_enabled=false) until product/legal retention is explicitly approved.
                {verificationSelfie && (
                  <span className="ml-1">Current: <strong>{verificationSelfie.worker_enabled ? "enabled ⚠" : "disabled ✓"}</strong>.</span>
                )}
              </p>
            </div>
            {data?.readiness.notes.map((note) => (
              <p key={note} className="text-muted-foreground text-xs">{note}</p>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── Owned media retention settings ──────────────────────────────────── */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            Owned media retention
          </CardTitle>
          <CardDescription>
            Controls the soft-delete window before physical purge. Eligibility release logic stays code-owned.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(["vibe_video", "profile_photo", "event_cover"] as OwnedFamily[]).map((mediaFamily) => (
            <div key={mediaFamily} className="rounded-2xl border border-border/50 bg-secondary/20 p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">{FAMILY_LABELS[mediaFamily]}</h3>
                    <Badge variant="secondary">soft delete window</Badge>
                    {!familyDrafts[mediaFamily].workerEnabled && (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-500">worker paused</Badge>
                    )}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-[160px_160px_auto] md:items-end">
                  <div className="space-y-2">
                    <Label htmlFor={`${mediaFamily}-days`}>Retention days</Label>
                    <Input
                      id={`${mediaFamily}-days`}
                      type="number"
                      min={0}
                      value={familyDrafts[mediaFamily].retentionDays}
                      onChange={(e) => setFamilyDrafts((curr) => ({
                        ...curr,
                        [mediaFamily]: { ...curr[mediaFamily], retentionDays: e.target.value },
                      }))}
                    />
                  </div>
                  <div className="flex h-10 items-center justify-between gap-3 rounded-xl border border-border/60 bg-background px-3">
                    <span className="text-sm text-foreground">Worker</span>
                    <Switch
                      checked={familyDrafts[mediaFamily].workerEnabled}
                      onCheckedChange={(checked) => setFamilyDrafts((curr) => ({
                        ...curr,
                        [mediaFamily]: { ...curr[mediaFamily], workerEnabled: checked },
                      }))}
                    />
                  </div>
                  <Button
                    className="gap-2"
                    onClick={() => saveFamilyMutation.mutate({ mediaFamily, draft: familyDrafts[mediaFamily] })}
                    disabled={saveFamilyMutation.isPending}
                  >
                    {saveFamilyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Chat media policy ────────────────────────────────────────────────── */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Chat media policy</CardTitle>
          <CardDescription>
            Applies to chat images, videos, thumbnails, and voice messages. Eligibility is backend-owned.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data?.settings.chat_policy.consistent ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600">
              Chat families are mixed. Saving here will normalize all four to one shared policy.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-[220px_180px_180px_auto] md:items-end">
            <div className="space-y-2">
              <Label>Retention mode</Label>
              <Select value={chatMode} onValueChange={(value: ChatMode) => setChatMode(value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="retain_until_eligible">Retain until eligible</SelectItem>
                  <SelectItem value="soft_delete">Soft delete after eligibility</SelectItem>
                  <SelectItem value="immediate">Immediate after eligibility</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Eligible days</Label>
              <Input
                type="number"
                min={0}
                value={chatEligibleDays}
                disabled={chatMode === "immediate"}
                onChange={(e) => setChatEligibleDays(e.target.value)}
              />
            </div>
            <div className="flex h-10 items-center justify-between gap-3 rounded-xl border border-border/60 bg-background px-3">
              <span className="text-sm text-foreground">Worker</span>
              <Switch checked={chatWorkerEnabled} onCheckedChange={setChatWorkerEnabled} />
            </div>
            <Button className="gap-2" onClick={() => saveChatMutation.mutate()} disabled={saveChatMutation.isPending}>
              {saveChatMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save chat policy
            </Button>
          </div>

          <div className="rounded-xl border border-border/50 bg-secondary/20 p-4 text-sm text-muted-foreground">
            <p>{data?.readiness.would_process_now.explanation}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
