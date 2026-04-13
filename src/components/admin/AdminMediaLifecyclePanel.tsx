import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock3, Loader2, RefreshCw, ShieldCheck, SlidersHorizontal } from "lucide-react";
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
    notes: string[];
  };
  recommended_activation: {
    verdict: "keep_disabled" | "enable_later" | "enable_now";
    initial_batch_size: number;
    initial_cadence: string;
    retry_behavior: string;
    initial_family_filter: string[] | null;
    rollback: string[];
    rationale: string;
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

function formatVerdict(verdict: SnapshotPayload["recommended_activation"]["verdict"]) {
  if (verdict === "keep_disabled") return "Keep disabled";
  if (verdict === "enable_now") return "Enable now";
  return "Enable later";
}

async function fetchSnapshot(): Promise<SnapshotPayload> {
  const { data, error } = await supabase.functions.invoke("admin-media-lifecycle-controls", {
    body: { action: "snapshot" },
  });

  if (error || !data?.success) {
    throw new Error(data?.error || error?.message || "Failed to load media lifecycle controls");
  }

  return data as SnapshotPayload & { success: true };
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
    setChatEligibleDays(
      data.settings.chat_policy.eligible_days === null ? "" : String(data.settings.chat_policy.eligible_days),
    );
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
        body: {
          action: "update_family",
          media_family: mediaFamily,
          retention_days: retentionDays,
          worker_enabled: draft.workerEnabled,
        },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to update setting");
      }
    },
    onSuccess: (_data, variables) => {
      toast.success(`${FAMILY_LABELS[variables.mediaFamily]} updated`);
      void qc.invalidateQueries({ queryKey: ["admin-media-lifecycle-controls"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save media setting");
    },
  });

  const saveChatMutation = useMutation({
    mutationFn: async () => {
      const eligibleDays = chatEligibleDays === "" ? null : Number(chatEligibleDays);
      if (eligibleDays !== null && (!Number.isInteger(eligibleDays) || eligibleDays < 0)) {
        throw new Error("Eligible days must be a non-negative whole number");
      }

      const { data, error } = await supabase.functions.invoke("admin-media-lifecycle-controls", {
        body: {
          action: "update_chat_policy",
          retention_mode: chatMode,
          eligible_days: eligibleDays,
          worker_enabled: chatWorkerEnabled,
        },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to update chat policy");
      }
    },
    onSuccess: () => {
      toast.success("Chat media policy updated");
      void qc.invalidateQueries({ queryKey: ["admin-media-lifecycle-controls"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save chat policy");
    },
  });

  const assetStatusRows = useMemo(() => data?.readiness.asset_status_counts ?? [], [data]);
  const jobStatusRows = useMemo(() => data?.readiness.job_status_counts ?? [], [data]);
  const readinessVerdict = data?.recommended_activation.verdict ?? "enable_later";
  const verificationSelfie = data?.settings.verification_selfie;

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
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-xl font-bold font-display text-foreground">Media lifecycle</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Admin-safe timing controls plus a read-only worker readiness preview. Eligibility rules stay code-owned:
            this panel only changes timing and worker gates, not the underlying release semantics.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh snapshot
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" />
              Would process now
            </CardTitle>
            <CardDescription>Read-only preview; no jobs are claimed here.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between"><span>Promotable assets</span><span className="font-semibold">{data?.readiness.would_process_now.promotable_assets ?? 0}</span></div>
            <div className="flex items-center justify-between"><span>Queued jobs</span><span className="font-semibold">{data?.readiness.would_process_now.queued_jobs ?? 0}</span></div>
            <div className="flex items-center justify-between"><span>Total candidates</span><span className="font-semibold">{data?.readiness.would_process_now.total_candidates ?? 0}</span></div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Queue health
            </CardTitle>
            <CardDescription>Failed jobs and anomaly counts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between"><span>Failed/abandoned jobs</span><span className="font-semibold">{jobStatusRows.filter((row) => row.status === "failed" || row.status === "abandoned").reduce((sum, row) => sum + row.count, 0)}</span></div>
            <div className="flex items-center justify-between"><span>Orphan-like assets</span><span className="font-semibold">{data?.readiness.orphan_like_counts.reduce((sum, row) => sum + row.count, 0) ?? 0}</span></div>
            <div className="flex items-center justify-between"><span>verification_selfie worker</span><span className="font-semibold">{verificationSelfie?.worker_enabled ? "enabled" : "disabled"}</span></div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Cron recommendation
            </CardTitle>
            <CardDescription>Cron is still disabled.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Badge
              variant="outline"
              className={readinessVerdict === "keep_disabled"
                ? "border-amber-500/40 text-amber-500"
                : "border-primary/40 text-primary"}
            >
              {formatVerdict(readinessVerdict)}
            </Badge>
            <div className="space-y-1 text-muted-foreground">
              <p>Initial batch size: <span className="text-foreground font-medium">{data?.recommended_activation.initial_batch_size}</span></p>
              <p>Cadence: <span className="text-foreground font-medium">{data?.recommended_activation.initial_cadence}</span></p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            Owned media retention
          </CardTitle>
          <CardDescription>
            These controls affect when released owned media becomes physically purgeable. Compatibility mirrors and lifecycle release logic stay unchanged.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(["vibe_video", "profile_photo", "event_cover"] as OwnedFamily[]).map((mediaFamily) => (
            <div key={mediaFamily} className="rounded-2xl border border-border/50 bg-secondary/20 p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">{FAMILY_LABELS[mediaFamily]}</h3>
                    <Badge variant="secondary">soft delete window</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Released assets stay soft-deleted until the configured retention window expires.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-[160px_160px_auto] md:items-end">
                  <div className="space-y-2">
                    <Label htmlFor={`${mediaFamily}-days`}>Retention days</Label>
                    <Input
                      id={`${mediaFamily}-days`}
                      type="number"
                      min={0}
                      value={familyDrafts[mediaFamily].retentionDays}
                      onChange={(e) => setFamilyDrafts((current) => ({
                        ...current,
                        [mediaFamily]: { ...current[mediaFamily], retentionDays: e.target.value },
                      }))}
                    />
                  </div>
                  <div className="flex h-10 items-center justify-between gap-3 rounded-xl border border-border/60 bg-background px-3">
                    <span className="text-sm text-foreground">Worker enabled</span>
                    <Switch
                      checked={familyDrafts[mediaFamily].workerEnabled}
                      onCheckedChange={(checked) => setFamilyDrafts((current) => ({
                        ...current,
                        [mediaFamily]: { ...current[mediaFamily], workerEnabled: checked },
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

      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Chat media policy</CardTitle>
          <CardDescription>
            Applies together to chat images, videos, thumbnails, and voice messages. Eligibility remains backend-owned; this only controls what happens after eligibility is satisfied.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data?.settings.chat_policy.consistent ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600">
              Chat families are currently mixed. Saving here will normalize all four chat media families to one shared policy.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-[220px_180px_180px_auto] md:items-end">
            <div className="space-y-2">
              <Label>Retention mode</Label>
              <Select value={chatMode} onValueChange={(value: ChatMode) => setChatMode(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
              <span className="text-sm text-foreground">Worker enabled</span>
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

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Readiness preview</CardTitle>
            <CardDescription>What a real worker activation would encounter right now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data?.readiness.would_process_now.by_family.length ? (
              <div className="space-y-2">
                {data.readiness.would_process_now.by_family.map((row) => (
                  <div key={row.media_family} className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/20 px-4 py-3 text-sm">
                    <span className="font-medium text-foreground">{row.media_family}</span>
                    <span className="text-muted-foreground">
                      {row.promotable_assets} promotable, {row.queued_jobs} queued
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing is currently due for worker processing.</p>
            )}

            <div className="space-y-2">
              <h4 className="font-medium text-foreground">Asset state counts</h4>
              <div className="space-y-2">
                {assetStatusRows.map((row) => (
                  <div key={`${row.media_family}-${row.status}`} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{row.media_family} · {row.status}</span>
                    <span className="font-medium text-foreground">{row.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Operator notes</CardTitle>
            <CardDescription>Guardrails before cron changes.</CardDescription>
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
              <p className="font-medium text-foreground mb-1">Current rationale</p>
              <p className="text-muted-foreground">{data?.recommended_activation.rationale}</p>
            </div>
            <div className="rounded-xl border border-border/50 bg-secondary/20 px-4 py-3">
              <p className="font-medium text-foreground mb-1">Locked policy</p>
              <p className="text-muted-foreground">
                verification_selfie stays worker-disabled until product/legal retention is explicitly approved.
              </p>
            </div>
            {data?.readiness.notes.map((note) => (
              <p key={note} className="text-muted-foreground">{note}</p>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
