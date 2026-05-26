import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Activity, Copy, Loader2, Search } from "lucide-react";
import {
  extractVideoDateTimelineTraceIds,
  isValidUuid,
  redactVideoDateTimelineDetail,
  safeVideoDateTimelineRows,
  type VideoDateSessionTimelineRow,
} from "@shared/admin-video-date-ops";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatAdminUtcDateTime, formatAdminUtcTime } from "@/lib/adminTime";
import { adminToast } from "@/lib/adminToast";
import { resolveAdminErrorMessage, resolveAdminFunctionErrorMessage } from "@/lib/adminErrorResolver";

type AdminVideoDateTimelineResponse = {
  ok: boolean;
  code?: string;
  error?: string;
  generated_at?: string;
  session_id?: string;
  rows?: VideoDateSessionTimelineRow[];
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const formatMs = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  return `${Math.round(value)}ms`;
};

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return { primary: value, iso: value };
  }
  return { primary: formatAdminUtcDateTime(date), iso: date.toISOString() };
};

const CopyIconButton = ({ value, label }: { value: string | null | undefined; label: string }) => {
  if (!value) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        if (!navigator.clipboard) {
          adminToast.error({
            id: `video-date-timeline-copy-unavailable-${label}`,
            title: "Clipboard unavailable",
          });
          return;
        }
        try {
          await navigator.clipboard.writeText(value);
          adminToast.success({
            id: `video-date-timeline-copied-${label}`,
            title: `${label} copied`,
          });
        } catch {
          adminToast.error({
            id: `video-date-timeline-copy-failed-${label}`,
            title: `Could not copy ${label}`,
          });
        }
      }}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
};

const statusClass = (outcome: string) => {
  switch (outcome) {
    case "success":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "blocked":
    case "error":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "no_op":
      return "bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
    default:
      return "bg-secondary text-muted-foreground border-white/10";
  }
};

const stateSummary = (detail: Record<string, unknown> | null) => {
  if (!detail) return [];
  return [
    ["action", asString(detail.action)],
    ["state", asString(detail.state_after) ?? asString(detail.state)],
    ["phase", asString(detail.phase_after) ?? asString(detail.phase)],
    ["ready_gate", asString(detail.status_after) ?? asString(detail.ready_gate_status)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
};

const AdminVideoDateTimelinePanel = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionIdFromUrl = searchParams.get("session_id")?.trim() ?? "";
  const [sessionInput, setSessionInput] = useState("");
  const [submittedSessionId, setSubmittedSessionId] = useState("");
  const trimmedSessionInput = sessionInput.trim();
  const canSubmit = isValidUuid(trimmedSessionInput);

  useEffect(() => {
    setSessionInput(sessionIdFromUrl);
    setSubmittedSessionId(isValidUuid(sessionIdFromUrl) ? sessionIdFromUrl : "");
  }, [sessionIdFromUrl]);

  const timelineQuery = useQuery({
    queryKey: ["admin-video-date-session-timeline", submittedSessionId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<AdminVideoDateTimelineResponse>(
        "admin-video-date-ops",
        {
          body: {
            action: "get_session_timeline",
            session_id: submittedSessionId,
          },
        },
      );

      if (error || !data?.ok) {
        throw new Error(await resolveAdminFunctionErrorMessage(error, data, "Timeline unavailable"));
      }
      return data;
    },
    enabled: Boolean(submittedSessionId),
    retry: false,
  });

  const rows = useMemo(
    () => safeVideoDateTimelineRows(timelineQuery.data?.rows ?? []),
    [timelineQuery.data?.rows],
  );

  const firstFrameWaterfalls = useMemo(
    () =>
      rows
        .filter((row) => row.operation === "video_date_launch_latency_checkpoint" && row.reason_code === "first_remote_frame")
        .map((row) => {
          const detail = asRecord(redactVideoDateTimelineDetail(row.detail));
          return {
            key: `${row.timeline_seq}-${row.actor_id ?? "unknown"}`,
            actorId: row.actor_id,
            platform: asString(detail?.platform),
            readyActorOrder: asString(detail?.ready_actor_order),
            readyTapToFrameMs: asNumber(detail?.ready_tap_to_first_remote_frame_ms),
            readyTapToBothReadyMs: asNumber(detail?.ready_tap_to_both_ready_ms),
            prepareEntryMs: asNumber(detail?.prepare_entry_ms),
            dateRouteBootstrapMs: asNumber(detail?.date_route_bootstrap_ms),
            dailyJoinMs: asNumber(detail?.daily_join_ms),
            dailyJoinToRemoteSeenMs: asNumber(detail?.daily_join_to_remote_seen_ms),
            remoteSeenToFrameMs: asNumber(detail?.remote_seen_to_first_remote_frame_ms),
            cachedPrepareEntry: detail?.cached_prepare_entry === true,
            providerVerifySkipped: detail?.provider_verify_skipped === true,
            permissionHandoffUsed: detail?.permission_handoff_used === true,
          };
        }),
    [rows],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextSessionId = trimmedSessionInput;
    if (!isValidUuid(nextSessionId)) {
      adminToast.error({
        id: "video-date-timeline-invalid-session-id",
        title: "Enter a valid video session UUID",
      });
      return;
    }
    setSubmittedSessionId(nextSessionId);
    setSearchParams((currentSearchParams) => {
      const nextSearchParams = new URLSearchParams(currentSearchParams);
      nextSearchParams.set("panel", "video-date-timeline");
      nextSearchParams.set("session_id", nextSessionId);
      return nextSearchParams;
    });
  };

  const handleSessionInputChange = (value: string) => {
    setSessionInput(value);
    if (value.trim() !== submittedSessionId) {
      setSubmittedSessionId("");
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-card p-6 rounded-2xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Video Date Session Timeline
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Service-role session timeline fetched through the admin Edge Function.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {submittedSessionId && !timelineQuery.isFetching && !timelineQuery.error && (
              <Badge className="bg-secondary text-muted-foreground border-white/10">
                {rows.length} rows
              </Badge>
            )}
            {timelineQuery.data?.generated_at && (
              <Badge className="bg-secondary text-muted-foreground border-white/10">
                fetched {formatAdminUtcTime(timelineQuery.data.generated_at)}
              </Badge>
            )}
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3 md:flex-row">
          <Input
            value={sessionInput}
            onChange={(event) => handleSessionInputChange(event.target.value)}
            placeholder="video session UUID"
            className="font-mono text-sm"
            spellCheck={false}
          />
          <Button type="submit" disabled={!canSubmit || timelineQuery.isFetching} className="gap-2 md:w-40">
            {timelineQuery.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Fetch
          </Button>
        </form>

        {trimmedSessionInput && !canSubmit && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">
            Invalid video session UUID.
          </div>
        )}

        {submittedSessionId && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{submittedSessionId}</span>
            <CopyIconButton value={submittedSessionId} label="session id" />
          </div>
        )}
      </div>

      {timelineQuery.error && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">
          {resolveAdminErrorMessage(timelineQuery.error, "Timeline unavailable")}
        </div>
      )}

      {firstFrameWaterfalls.length > 0 && (
        <div className="glass-card p-5 rounded-2xl space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Ready Tap to First Frame Waterfall</h3>
            <p className="text-xs text-muted-foreground mt-1">
              One row per participant checkpoint. First frame is still blurred by design.
            </p>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {firstFrameWaterfalls.map((item) => (
              <div key={item.key} className="rounded-xl border border-white/10 bg-secondary/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <span className="font-mono">{item.actorId || "unknown actor"}</span>
                  </div>
                  <Badge className="bg-primary/15 text-primary border-primary/30">
                    {formatMs(item.readyTapToFrameMs)}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <span>platform: {item.platform || "n/a"}</span>
                  <span>order: {item.readyActorOrder || "n/a"}</span>
                  <span>tap-&gt;both: {formatMs(item.readyTapToBothReadyMs)}</span>
                  <span>prepare: {formatMs(item.prepareEntryMs)}</span>
                  <span>route boot: {formatMs(item.dateRouteBootstrapMs)}</span>
                  <span>Daily join: {formatMs(item.dailyJoinMs)}</span>
                  <span>join-&gt;remote: {formatMs(item.dailyJoinToRemoteSeenMs)}</span>
                  <span>remote-&gt;frame: {formatMs(item.remoteSeenToFrameMs)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge className="bg-secondary text-muted-foreground border-white/10">
                    cache: {item.cachedPrepareEntry ? "hit" : "miss/unknown"}
                  </Badge>
                  <Badge className="bg-secondary text-muted-foreground border-white/10">
                    provider verify: {item.providerVerifySkipped ? "skipped" : "ran/unknown"}
                  </Badge>
                  <Badge className="bg-secondary text-muted-foreground border-white/10">
                    permission handoff: {item.permissionHandoffUsed ? "yes" : "no/unknown"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => {
            const detail = asRecord(redactVideoDateTimelineDetail(row.detail));
            const traceIds = extractVideoDateTimelineTraceIds(detail);
            const stateItems = stateSummary(detail);
            const timestamp = formatTimestamp(row.occurred_at);

            return (
              <div key={`${row.timeline_seq}-${row.operation}-${row.occurred_at}`} className="glass-card p-4 rounded-2xl">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-secondary text-foreground border-white/10">#{row.timeline_seq}</Badge>
                      <Badge className="bg-primary/15 text-primary border-primary/30">{row.operation}</Badge>
                      <Badge className={statusClass(row.outcome)}>{row.outcome}</Badge>
                      {row.reason_code && (
                        <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30">{row.reason_code}</Badge>
                      )}
                    </div>
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      <div>{timestamp.primary}</div>
                      <div className="font-mono text-[10px]">{timestamp.iso}</div>
                    </div>
                  </div>
                  <Badge className="bg-secondary text-muted-foreground border-white/10">{row.source}</Badge>
                </div>

                <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div className="flex min-w-0 items-center gap-1">
                    <span>actor_id:</span>
                    <span className="font-mono truncate">{row.actor_id || "-"}</span>
                    <CopyIconButton value={row.actor_id} label="actor id" />
                  </div>
                  <div className="flex min-w-0 items-center gap-1">
                    <span>event_id:</span>
                    <span className="font-mono truncate">{row.event_id || "-"}</span>
                    <CopyIconButton value={row.event_id} label="event id" />
                  </div>
                  <div className="flex min-w-0 items-center gap-1">
                    <span>entry_attempt_id:</span>
                    <span className="font-mono truncate">{traceIds.entryAttemptId || "-"}</span>
                    <CopyIconButton value={traceIds.entryAttemptId} label="entry attempt id" />
                  </div>
                  <div className="flex min-w-0 items-center gap-1">
                    <span>video_date_trace_id:</span>
                    <span className="font-mono truncate">{traceIds.videoDateTraceId || "-"}</span>
                    <CopyIconButton value={traceIds.videoDateTraceId} label="trace id" />
                  </div>
                </div>

                {stateItems.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {stateItems.map(([label, value]) => (
                      <Badge key={`${row.timeline_seq}-${label}`} className="bg-secondary text-muted-foreground border-white/10">
                        {label}: {value}
                      </Badge>
                    ))}
                  </div>
                )}

                <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-white/10 bg-background/80 p-3 text-[11px] leading-relaxed text-muted-foreground">
                  {JSON.stringify(detail ?? {}, null, 2)}
                </pre>
              </div>
            );
          })}
        </div>
      )}

      {submittedSessionId && !timelineQuery.isFetching && !timelineQuery.error && rows.length === 0 && (
        <div className="glass-card p-8 rounded-2xl text-center text-sm text-muted-foreground">
          No timeline rows found for this session.
        </div>
      )}

      {!submittedSessionId && !trimmedSessionInput && (
        <div className="glass-card p-8 rounded-2xl text-center text-sm text-muted-foreground">
          No session selected.
        </div>
      )}
    </div>
  );
};

export default AdminVideoDateTimelinePanel;
