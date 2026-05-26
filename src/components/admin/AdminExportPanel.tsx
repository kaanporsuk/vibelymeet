import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  File,
  FileSpreadsheet,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { format, subDays, subMonths } from "date-fns";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { callAdminRpc, sanitizeAdminRpcErrorMessage, type AdminRpcPayload } from "@/lib/adminRpc";
import { resolveSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionInvokeErrors";
import { toast } from "sonner";

type GovernedExportScope =
  | "user"
  | "reports"
  | "support"
  | "analytics"
  | "audit"
  | "events"
  | "revenue"
  | "messages"
  | "notifications"
  | "operations"
  | "intelligence"
  | "compliance";
type ExportFormat = "csv" | "printable_html";
type PiiClassification = "aggregate" | "pseudonymous" | "sensitive" | "special_category";
type DateFilter = { start: string | null; end: string | null; label: string };

type GovernedExportOption = {
  id: GovernedExportScope;
  label: string;
  description: string;
  pii: PiiClassification;
  requiresUserId?: boolean;
  supportsEventId?: boolean;
};

type ExportJobRow = {
  id: string;
  request_id: string | null;
  created_by: string | null;
  scope_type: string;
  scope: Record<string, unknown> | null;
  reason: string;
  status: string;
  pii_classification: string;
  row_count_estimate: number;
  storage_path: string | null;
  expires_at: string;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
};

type ExportJobsPayload = AdminRpcPayload & {
  rows?: ExportJobRow[];
  total_count?: number;
};

type PermissionPayload = AdminRpcPayload & {
  allowed?: boolean;
};

type GovernedExportResponse = AdminRpcPayload & {
  request_id?: string;
  job_id?: string;
  status?: string;
  row_count_estimate?: number;
  expires_at?: string;
  audit_log_id?: string;
  storage_path?: string | null;
  generation_semantics?: string;
};

const governedExportOptions: GovernedExportOption[] = [
  {
    id: "user",
    label: "Compliance/User DSAR Bundle",
    description: "User-scoped export queue for profile, support, reports, registrations, consent, and deletion evidence.",
    pii: "special_category",
    requiresUserId: true,
  },
  {
    id: "reports",
    label: "Trust & Safety Reports",
    description: "Report/moderation export scope for safety review and policy evidence.",
    pii: "special_category",
  },
  {
    id: "events",
    label: "Events & Registrations",
    description: "Event, registration, waitlist/payment-exception, and lifecycle-review export scope.",
    pii: "sensitive",
    supportsEventId: true,
  },
  {
    id: "revenue",
    label: "Revenue & Entitlements",
    description: "Premium, subscription, credit, and payment-observability export scope.",
    pii: "sensitive",
  },
  {
    id: "messages",
    label: "Messaging & Matches",
    description: "Match, message-count, video-session, date-feedback, block/report-adjacent export scope.",
    pii: "special_category",
  },
  {
    id: "notifications",
    label: "Notifications & Push",
    description: "Notification logs, admin notifications, push campaigns, telemetry, and suppression-review scope.",
    pii: "pseudonymous",
  },
  {
    id: "support",
    label: "Support Operations",
    description: "Support tickets, events, replies, attachments, and internal notes export scope.",
    pii: "sensitive",
  },
  {
    id: "audit",
    label: "Admin Audit Trail",
    description: "Admin activity logs and production-impacting action evidence.",
    pii: "pseudonymous",
  },
  {
    id: "operations",
    label: "Operations Diagnostics",
    description: "Media jobs, video sessions, provider usage/cost, quality budgets, and operational evidence.",
    pii: "pseudonymous",
  },
  {
    id: "intelligence",
    label: "P4 Intelligence Snapshots",
    description: "Liquidity, trust triage, cost, quality, and product-intelligence snapshot scope.",
    pii: "aggregate",
  },
  {
    id: "analytics",
    label: "Aggregate Analytics",
    description: "Aggregate product and admin analytics export scope with no user bundle semantics.",
    pii: "aggregate",
  },
  {
    id: "compliance",
    label: "Compliance Registry",
    description: "Data requests, export jobs, consent events, and retention-policy evidence.",
    pii: "sensitive",
  },
];

const piiLabels: Record<PiiClassification, string> = {
  aggregate: "Aggregate",
  pseudonymous: "Pseudonymous",
  sensitive: "Sensitive",
  special_category: "Special category",
};

const piiRank: Record<PiiClassification, number> = {
  aggregate: 0,
  pseudonymous: 1,
  sensitive: 2,
  special_category: 3,
};

function isPiiAllowedForScope(option: GovernedExportOption, classification: PiiClassification): boolean {
  return piiRank[classification] >= piiRank[option.pii];
}

const formatDateTime = (value: string | null | undefined) =>
  value ? format(new Date(value), "yyyy-MM-dd HH:mm:ss") : "";

const AdminExportPanel = () => {
  const [selectedGovernedScope, setSelectedGovernedScope] = useState<GovernedExportScope>("user");
  const [dateRange, setDateRange] = useState("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [piiClassification, setPiiClassification] = useState<PiiClassification>("special_category");
  const [reason, setReason] = useState("");
  const [userId, setUserId] = useState("");
  const [eventId, setEventId] = useState("");
  const [queuedJob, setQueuedJob] = useState<GovernedExportResponse | null>(null);
  const [isQueueing, setIsQueueing] = useState(false);

  const selectedGovernedOption = governedExportOptions.find((option) => option.id === selectedGovernedScope) ?? governedExportOptions[0];

  const compliancePermission = useQuery({
    queryKey: ["admin-export-compliance-permission"],
    queryFn: () => callAdminRpc<PermissionPayload>("admin_has_permission", { p_permission: "compliance.manage" }),
    staleTime: 60_000,
  });

  const exportJobs = useQuery({
    queryKey: ["admin-export-jobs"],
    queryFn: () =>
      callAdminRpc<ExportJobsPayload>("admin_list_data_export_jobs", {
        p_limit: 8,
        p_offset: 0,
        p_filters: {},
      }),
    staleTime: 30_000,
  });

  const hasCompliancePermission = compliancePermission.data?.allowed === true;
  const isCustomRangeIncomplete = dateRange === "custom" && (!customStartDate || !customEndDate);
  const isCustomRangeReversed = dateRange === "custom" && !!customStartDate && !!customEndDate && customStartDate > customEndDate;
  const hasInvalidDateRange = isCustomRangeIncomplete || isCustomRangeReversed;
  const isPiiBelowScopeMinimum = !isPiiAllowedForScope(selectedGovernedOption, piiClassification);

  const dateFilter = useMemo<DateFilter>(() => {
    const now = new Date();
    const end = now.toISOString();

    if (dateRange === "custom" && customStartDate && customEndDate) {
      return {
        start: new Date(`${customStartDate}T00:00:00.000Z`).toISOString(),
        end: new Date(`${customEndDate}T23:59:59.999Z`).toISOString(),
        label: `${customStartDate} to ${customEndDate} UTC`,
      };
    }

    switch (dateRange) {
      case "7d":
        return { start: subDays(now, 7).toISOString(), end, label: "Last 7 days" };
      case "30d":
        return { start: subDays(now, 30).toISOString(), end, label: "Last 30 days" };
      case "90d":
        return { start: subDays(now, 90).toISOString(), end, label: "Last 90 days" };
      case "1y":
        return { start: subMonths(now, 12).toISOString(), end, label: "Last year" };
      default:
        return { start: null, end: null, label: "All time" };
    }
  }, [dateRange, customStartDate, customEndDate]);

  const buildGovernedScope = () => {
    const scope: Record<string, unknown> = {
      date_range: dateRange,
      date_range_label: dateFilter.label,
      window_start: dateFilter.start,
      window_end: dateFilter.end,
      requested_format: exportFormat,
    };
    if (selectedGovernedOption.requiresUserId) scope.user_id = userId.trim();
    if (selectedGovernedOption.supportsEventId && eventId.trim()) scope.event_id = eventId.trim();
    return scope;
  };

  const queueGovernedExport = async () => {
    if (hasCompliancePermission !== true) {
      toast.error("Compliance permission is required for governed exports.");
      return;
    }
    if (hasInvalidDateRange) {
      toast.error(isCustomRangeReversed ? "Custom start date must be before the end date." : "Both custom dates are required.");
      return;
    }
    if (isPiiBelowScopeMinimum) {
      toast.error(`This scope requires ${piiLabels[selectedGovernedOption.pii]} classification or higher.`);
      return;
    }
    if (!reason.trim()) {
      toast.error("A reason is required for governed exports.");
      return;
    }
    if (selectedGovernedOption.requiresUserId && !userId.trim()) {
      toast.error("A user ID is required for this governed export scope.");
      return;
    }

    setIsQueueing(true);
    setQueuedJob(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-data-export", {
        body: {
          scope_type: selectedGovernedScope,
          scope: buildGovernedScope(),
          reason: reason.trim(),
          pii_classification: piiClassification,
        },
      });
      if (error) {
        throw new Error(await resolveSupabaseFunctionErrorMessage(error, data, "Governed export queue failed"));
      }
      const payload = data as GovernedExportResponse | null;
      if (!payload || payload.success === false || payload.ok === false) {
        throw new Error(payload?.message || payload?.error || "Governed export queue failed");
      }
      setQueuedJob(payload);
      await exportJobs.refetch();
      toast.success("Governed export queued");
    } catch (error) {
      toast.error(sanitizeAdminRpcErrorMessage(error));
    } finally {
      setIsQueueing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <Alert className="border-primary/30 bg-primary/10">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Governed export queue is the only export path</AlertTitle>
        <AlertDescription>
          Exports require a reason, permission, PII classification, audit log, and expiry. File generation remains a controlled worker step.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-4">
        <div className="glass-card p-4 rounded-2xl space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Governed Export Queue</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Creates an audited export job. Download delivery remains pending until the governed worker generates an expiring private file.
              </p>
            </div>
            <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Audited</Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Scope</Label>
              <Select value={selectedGovernedScope} onValueChange={(value) => {
                const option = governedExportOptions.find((item) => item.id === value);
                setSelectedGovernedScope(value as GovernedExportScope);
                setPiiClassification(option?.pii ?? "sensitive");
              }}>
                <SelectTrigger className="bg-secondary/50">
                  <SelectValue placeholder="Select governed scope" />
                </SelectTrigger>
                <SelectContent>
                  {governedExportOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{selectedGovernedOption.description}</p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">PII Classification</Label>
              <Select value={piiClassification} onValueChange={(value) => setPiiClassification(value as PiiClassification)}>
                <SelectTrigger className="bg-secondary/50">
                  <SelectValue placeholder="Select PII classification" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(piiLabels) as PiiClassification[]).map((key) => (
                    <SelectItem key={key} value={key} disabled={!isPiiAllowedForScope(selectedGovernedOption, key)}>
                      {piiLabels[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Minimum for this scope: {piiLabels[selectedGovernedOption.pii]}.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Date Range</Label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="bg-secondary/50">
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="90d">Last 90 Days</SelectItem>
                  <SelectItem value="1y">Last Year</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Stored as ISO timestamps; reporting and backend queue metadata use UTC.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Output Request</Label>
              <Select value={exportFormat} onValueChange={(value) => setExportFormat(value as ExportFormat)}>
                <SelectTrigger className="bg-secondary/50">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4" />
                      CSV
                    </div>
                  </SelectItem>
                  <SelectItem value="printable_html">
                    <div className="flex items-center gap-2">
                      <File className="w-4 h-4" />
                      Printable HTML / Save as PDF
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {dateRange === "custom" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Start Date</Label>
                <Input type="date" value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} className="bg-secondary/50" />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">End Date</Label>
                <Input type="date" value={customEndDate} onChange={(event) => setCustomEndDate(event.target.value)} className="bg-secondary/50" />
              </div>
            </div>
          )}

          {compliancePermission.isError ? (
            <Alert className="border-destructive/30 bg-destructive/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Compliance permission unavailable</AlertTitle>
              <AlertDescription>
                {sanitizeAdminRpcErrorMessage(compliancePermission.error)}
              </AlertDescription>
            </Alert>
          ) : null}

          {hasInvalidDateRange ? (
            <Alert className="border-amber-500/30 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Custom date range required</AlertTitle>
              <AlertDescription>
                {isCustomRangeReversed
                  ? "The custom start date must be before the end date."
                  : "Select both custom dates before queueing an export. The panel will not fall back to all-time data."}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedGovernedOption.requiresUserId ? (
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">User ID</Label>
                <Input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Required UUID for user-scoped exports" className="bg-secondary/50" />
              </div>
            ) : null}
            {selectedGovernedOption.supportsEventId ? (
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Event ID</Label>
                <Input value={eventId} onChange={(event) => setEventId(event.target.value)} placeholder="Optional UUID to scope one event" className="bg-secondary/50" />
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Reason</Label>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required: case number, DSAR request, incident review, or operational reason" />
          </div>

          <Button onClick={queueGovernedExport} disabled={isQueueing || compliancePermission.isLoading || hasCompliancePermission !== true || hasInvalidDateRange || isPiiBelowScopeMinimum} className="w-full gap-2">
            {isQueueing ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockKeyhole className="w-4 h-4" />}
            {hasCompliancePermission === false ? "Compliance permission required" : "Queue Governed Export"}
          </Button>

          {queuedJob ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200 space-y-2">
              <div className="font-medium">Export job queued</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <span>Job ID: <code>{queuedJob.job_id}</code></span>
                <span>Audit log: <code>{queuedJob.audit_log_id}</code></span>
                <span>Rows estimated: {(queuedJob.row_count_estimate ?? 0).toLocaleString()}</span>
                <span>Expires: {formatDateTime(queuedJob.expires_at)}</span>
              </div>
              <p className="text-xs text-emerald-100/80">{queuedJob.generation_semantics || "File generation pending."}</p>
            </div>
          ) : null}
        </div>

        <div className="glass-card p-4 rounded-2xl space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Recent Export Jobs</h3>
              <p className="text-xs text-muted-foreground">Read-only queue status from governed export metadata.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => exportJobs.refetch()} disabled={exportJobs.isFetching}>
              <RefreshCw className={`w-4 h-4 ${exportJobs.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {exportJobs.isError ? (
            <Alert className="border-destructive/30 bg-destructive/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Export jobs unavailable</AlertTitle>
              <AlertDescription>{exportJobs.error instanceof Error ? exportJobs.error.message : "Could not read governed export jobs."}</AlertDescription>
            </Alert>
          ) : exportJobs.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading export jobs...
            </div>
          ) : (exportJobs.data?.rows ?? []).length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-secondary/20 p-4 text-sm text-muted-foreground">
              No governed export jobs are visible for your permissions.
            </div>
          ) : (
            <div className="space-y-3">
              {(exportJobs.data?.rows ?? []).map((job) => (
                <div key={job.id} className="rounded-xl border border-border/60 bg-secondary/20 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">{job.scope_type}</div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(job.created_at)}</div>
                    </div>
                    <Badge className="bg-primary/15 text-primary border-primary/30">{job.status}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground line-clamp-2">{job.reason}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{job.row_count_estimate.toLocaleString()} rows estimated</span>
                    <span>{job.pii_classification}</span>
                    <span>{job.storage_path ? "File ready" : "File generation pending"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="glass-card p-4 rounded-2xl">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-sm text-foreground font-medium">Export Information</p>
            <p className="text-xs text-muted-foreground">
              Governed exports are the export-of-record path. This panel queues audited jobs only; browser-local table reads and direct downloads are intentionally unavailable.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminExportPanel;
