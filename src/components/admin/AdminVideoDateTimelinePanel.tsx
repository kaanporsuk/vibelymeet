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
