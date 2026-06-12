import { useRef, useState } from "react";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { REPORT_REASONS, type ReportReasonId } from "@clientShared/safety/reportReasons";
import {
  submitUserReportRpc,
  submitVideoDateSafetyReportRpc,
  type SubmitVideoDateSafetyReportRpcResult,
} from "@clientShared/safety/submitUserReportRpc";
import {
  isVideoDateSafetySubmitErrorRetryable,
  resolveVideoDateSafetySubmitCopy,
  resolveVideoDateSafetySubmitOutcome,
  type VideoDateSafetySubmitOutcome,
} from "@clientShared/safety/videoDateSafetyCopy";
import {
  buildVideoDateSafetyIdempotencyKey,
  createVideoDateClientRequestId,
} from "@clientShared/matching/videoDateTransitionCommands";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportedUserId: string | null;
  sessionId?: string | null;
  /** Submit report only; stay on call */
  onReportOnlySuccess?: (outcome: VideoDateSafetySubmitOutcome) => void | Promise<void>;
  /** After successful report, end call + survey (parent handles end) */
  onEndAfterReport?: () => void | Promise<void>;
  /** v2 path: report RPC already ended server state; parent cleans local media + opens the right terminal UX. */
  onServerEndedAfterReport?: (
    result: Extract<SubmitVideoDateSafetyReportRpcResult, { ok: true }>,
    outcome: VideoDateSafetySubmitOutcome,
  ) => void | Promise<void>;
};

export function InCallSafetyModal({
  open,
  onOpenChange,
  reportedUserId,
  sessionId,
  onReportOnlySuccess,
  onEndAfterReport,
  onServerEndedAfterReport,
}: Props) {
  const [reason, setReason] = useState<ReportReasonId>("harassment");
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [submitting, setSubmitting] = useState<"idle" | "report" | "end">("idle");
  const requestRef = useRef<{ mode: "report" | "end"; key: string; payloadSignature: string } | null>(null);
  const submitInFlightRef = useRef(false);

  const reset = () => {
    setReason("harassment");
    setDetails("");
    setAlsoBlock(false);
    setSubmitting("idle");
    requestRef.current = null;
    submitInFlightRef.current = false;
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && submitInFlightRef.current) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async (mode: "report" | "end") => {
    if (!reportedUserId || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitting(mode);
    const trimmedDetails = details.trim() || null;
    let result: SubmitVideoDateSafetyReportRpcResult = { ok: false, error: "Could not send report. Try again." };
    try {
      if (sessionId) {
        const payloadSignature = JSON.stringify({
          reason,
          details: trimmedDetails,
          alsoBlock,
          endSession: mode === "end",
        });
        const existing =
          requestRef.current?.mode === mode && requestRef.current.payloadSignature === payloadSignature
            ? requestRef.current
            : null;
        const key =
          existing?.key ??
          buildVideoDateSafetyIdempotencyKey(
            sessionId,
            mode === "end" ? "end_report" : "report",
            createVideoDateClientRequestId(),
          );
        requestRef.current = { mode, key, payloadSignature };
        result = await submitVideoDateSafetyReportRpc(supabase, {
          sessionId,
          reason,
          details: trimmedDetails,
          alsoBlock,
          endSession: mode === "end",
          idempotencyKey: key,
        });
      } else {
        const legacyResult = await submitUserReportRpc(supabase, {
          reportedId: reportedUserId,
          reason,
          details: trimmedDetails,
          alsoBlock,
        });
        if (legacyResult.ok === true) {
          result = { ok: true, reportId: legacyResult.reportId, ended: false, surveyRequired: false, idempotent: false };
        } else {
          result = { ok: false, error: legacyResult.error };
        }
      }
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : "Could not send report. Try again." };
    }
    if (!result.ok) {
      setSubmitting("idle");
      submitInFlightRef.current = false;
      const error = "error" in result ? result.error : "Could not send report. Try again.";
      const retryable = isVideoDateSafetySubmitErrorRetryable(error);
      const copy = resolveVideoDateSafetySubmitCopy({
        ok: false,
        mode,
        error,
        reportRecorded: "reportRecorded" in result ? result.reportRecorded : false,
        retryable,
      });
      if (copy.tone === "warning") {
        toast.info(copy.title, { description: copy.message });
      } else {
        toast.error(copy.title, { description: copy.message });
      }
      if (!retryable) {
        handleOpenChange(false);
      }
      return;
    }
    const copy = resolveVideoDateSafetySubmitCopy({
      ok: true,
      mode,
      alsoBlock,
      ended: result.ended,
      surveyRequired: result.surveyRequired,
      idempotent: result.idempotent,
    });
    const outcome = resolveVideoDateSafetySubmitOutcome({
      mode,
      alsoBlock,
      ended: result.ended,
      surveyRequired: result.surveyRequired,
      idempotent: result.idempotent,
      reportRecorded: true,
      reportId: result.reportId,
    });
    toast.success(copy.title, { description: copy.message });
    reset();
    handleOpenChange(false);
    if (result.ended) {
      await onServerEndedAfterReport?.(result, outcome);
    } else if (mode === "report") {
      await onReportOnlySuccess?.(outcome);
    } else {
      await onEndAfterReport?.();
    }
  };

  const disabled = !reportedUserId || submitting !== "idle";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <DialogTitle>Safety</DialogTitle>
          </div>
          <DialogDescription>
            Report inappropriate behavior. Our team reviews reports promptly. You can stay on the call or end it after
            reporting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="in-call-report-reason">Reason</Label>
            <select
              id="in-call-report-reason"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={reason}
              onChange={(e) => setReason(e.target.value as ReportReasonId)}
              disabled={disabled}
            >
              {REPORT_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="in-call-report-details">Details (optional)</Label>
            <Textarea
              id="in-call-report-details"
              placeholder="What happened?"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              disabled={disabled}
              rows={3}
              className="resize-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="in-call-report-block"
              checked={alsoBlock}
              onCheckedChange={(v) => setAlsoBlock(v === true)}
              disabled={disabled}
            />
            <Label htmlFor="in-call-report-block" className="text-sm font-normal cursor-pointer">
              Also block this person
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => void submit("report")}
          >
            {submitting === "report" ? "Sending…" : "Report"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={disabled}
            onClick={() => void submit("end")}
          >
            {submitting === "end" ? "Ending…" : "End & report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
