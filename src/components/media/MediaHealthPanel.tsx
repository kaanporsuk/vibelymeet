import { Activity, RefreshCw, UploadCloud, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMediaPlaybackQoeSnapshot, mediaConnectionSnapshot } from "@/lib/mediaPlaybackSessionPolicy";

export type MediaHealthUploadSummary = {
  enqueued: number;
  succeeded: number;
  failed: number;
  inFlight: number;
  queued: number;
};

type Props = {
  uploadSummary: MediaHealthUploadSummary;
  onRetryFailed: () => void;
};

export function MediaHealthPanel({ uploadSummary, onRetryFailed }: Props) {
  const qoe = getMediaPlaybackQoeSnapshot();
  const connection = mediaConnectionSnapshot();
  const attempted = uploadSummary.succeeded + uploadSummary.failed;
  const successRate = attempted > 0 ? Math.round((uploadSummary.succeeded / attempted) * 100) : null;

  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Media health</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
            Uploads
          </div>
          <p className="mt-2 text-2xl font-bold text-foreground">{successRate == null ? "No data" : `${successRate}%`}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {uploadSummary.succeeded} sent · {uploadSummary.failed} failed · {uploadSummary.inFlight + uploadSummary.queued} pending
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            Playback
          </div>
          <p className="mt-2 text-2xl font-bold text-foreground">{qoe.qoeDegraded ? "Degraded" : "Stable"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {qoe.recentRebufferCount} rebuffers · startup {qoe.lastStartupMs == null ? "unknown" : `${qoe.lastStartupMs} ms`}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
            Connection
          </div>
          <p className="mt-2 text-2xl font-bold text-foreground">
            {connection.effectiveType === "unknown" ? "Unknown" : connection.effectiveType.toUpperCase()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {connection.saveData ? "Save-data enabled" : "Save-data off"} · prewarm {Math.round(qoe.prewarmBytesUsed / 1024)} KB
          </p>
        </div>
      </div>

      <Button type="button" onClick={onRetryFailed} disabled={uploadSummary.failed === 0} className="w-full gap-2">
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Retry failed uploads
      </Button>
    </div>
  );
}
