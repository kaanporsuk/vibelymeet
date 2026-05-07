import { useState } from "react";
import {
  Calendar,
  CheckCircle,
  Database,
  Eye,
  Info,
  Loader2,
  MousePointer,
  Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePushAnalytics, PushAnalyticsRange } from "@/hooks/usePushAnalytics";

type SummaryMetricProps = {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
};

const SummaryMetric = ({ icon, label, value, detail }: SummaryMetricProps) => (
  <Card className="bg-card border-border">
    <CardContent className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </CardContent>
  </Card>
);

const PushAnalyticsDashboard = () => {
  const [dateRange, setDateRange] = useState<PushAnalyticsRange>("30d");

  const { data, isLoading, error } = usePushAnalytics(dateRange);

  const renderHeader = () => (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Push Notification Analytics</h3>
        <p className="text-sm text-muted-foreground">
          Backend admin metrics RPC only; provider sends may exist outside these rows.
        </p>
      </div>
      <Select value={dateRange} onValueChange={(v: PushAnalyticsRange) => setDateRange(v)}>
        <SelectTrigger className="w-32 bg-secondary/50">
          <Calendar className="w-4 h-4 mr-2" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7d">Last 7 days</SelectItem>
          <SelectItem value="14d">Last 14 days</SelectItem>
          <SelectItem value="30d">Last 30 days</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        {renderHeader()}
        <Card className="bg-card border-border">
          <CardContent className="p-6 text-center text-muted-foreground">
            Unable to read push analytics from the backend admin metrics RPC.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { appNotificationLog, pushTelemetry, telemetryRowCount, windowLabel } = data;

  if (telemetryRowCount === 0) {
    return (
      <div className="space-y-6">
        {renderHeader()}
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-start gap-3 text-muted-foreground">
              <Info className="w-5 h-5 mt-0.5 text-primary" />
              <div>
                <p className="font-medium text-foreground">No telemetry available in this range.</p>
                <p className="text-sm mt-1">
                  No telemetry available in this range; this does not prove no notifications were sent.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {renderHeader()}

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Selected-Window Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {windowLabel}. Provider/admin telemetry and transactional app logs are separate sources.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryMetric
          icon={<Database className="w-4 h-4" />}
          label="Provider/Admin Rows"
          value={pushTelemetry.queuedRows.toLocaleString()}
          detail="push_notification_events_admin rows"
        />
        <SummaryMetric
          icon={<Send className="w-4 h-4" />}
          label="Accepted / Sent"
          value={pushTelemetry.sentRows.toLocaleString()}
          detail={`${pushTelemetry.deliveryRate}% delivery telemetry rate`}
        />
        <SummaryMetric
          icon={<CheckCircle className="w-4 h-4" />}
          label="Delivered"
          value={pushTelemetry.deliveredRows.toLocaleString()}
          detail={`${pushTelemetry.openRate}% open telemetry rate`}
        />
        <SummaryMetric
          icon={<Eye className="w-4 h-4" />}
          label="Opened / Clicked"
          value={`${pushTelemetry.openedRows.toLocaleString()} / ${pushTelemetry.clickedRows.toLocaleString()}`}
          detail={`${pushTelemetry.clickRate}% click telemetry rate`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              Provider/Admin Telemetry
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Queued rows</span>
              <span className="font-medium text-foreground">{pushTelemetry.queuedRows.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Sent rows</span>
              <span className="font-medium text-foreground">{pushTelemetry.sentRows.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Delivered rows</span>
              <span className="font-medium text-foreground">{pushTelemetry.deliveredRows.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Opened rows</span>
              <span className="font-medium text-foreground">{pushTelemetry.openedRows.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Clicked rows</span>
              <span className="font-medium text-foreground">{pushTelemetry.clickedRows.toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MousePointer className="w-4 h-4 text-accent" />
              Transactional App Log
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Notification log rows</span>
              <span className="font-medium text-foreground">{appNotificationLog.logRows.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Delivered=true rows</span>
              <span className="font-medium text-foreground">{appNotificationLog.deliveredRows.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Suppressed rows</span>
              <span className="font-medium text-foreground">{appNotificationLog.suppressedRows.toLocaleString()}</span>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
              notification_log delivery means the backend accepted or suppressed a send request; it is not provider open/click telemetry.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <Info className="w-4 h-4 mt-0.5 text-primary" />
            <p>
              This RPC does not return per-day, device, campaign, or best-time breakdowns yet. Those charts stay hidden until the backend provides real grouped data.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PushAnalyticsDashboard;
