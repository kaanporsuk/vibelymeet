import { useState } from "react";
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
import { submitUserReportRpc } from "@clientShared/safety/submitUserReportRpc";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportedUserId: string | null;
  /** Submit report only; stay on call */
  onReportOnlySuccess?: () => void;
  /** After successful report, end call + survey (parent handles end) */
  onEndAfterReport?: () => void | Promise<void>;
};

export function InCallSafetyModal({
  open,
  onOpenChange,
  reportedUserId,
  onReportOnlySuccess,
  onEndAfterReport,
}: Props) {
  const [reason, setReason] = useState<ReportReasonId>("harassment");
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [submitting, setSubmitting] = useState<"idle" | "report" | "end">("idle");

  const reset = () => {
    setReason("harassment");
    setDetails("");
    setAlsoBlock(false);
    setSubmitting("idle");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async (mode: "report" | "end") => {
    if (!reportedUserId) return;
    setSubmitting(mode);
    const result = await submitUserReportRpc(supabase, {
      reportedId: reportedUserId,
      reason,
      details: details.trim() || null,
      alsoBlock,
    });
    setSubmitting("idle");
    if (!result.ok) {
      toast.error("error" in result ? result.error : "Could not send report. Try again.");
      return;
    }
    toast.success(mode === "end" ? "Report sent — ending the date." : "Thanks — we received your report.");
    reset();
    handleOpenChange(false);
    if (mode === "report") {
      onReportOnlySuccess?.();
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
