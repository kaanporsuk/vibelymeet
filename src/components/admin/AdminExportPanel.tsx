import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  Heart,
  History,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { format, subDays, subMonths } from "date-fns";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
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
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";
import { normalizeRelationshipIntentId } from "@shared/profileContracts";
import { toast } from "sonner";

type LegacyExportType = "users" | "matches" | "events" | "reports" | "activity_logs";
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

type ExportCell = string | number | boolean | null | undefined;
type ProfileVibeExportRow = {
  profile_id: string;
  vibe_tags: { label: string | null } | { label: string | null }[] | null;
};
type SupabaseMaybeError = { message?: string } | null;
type PageResult<T> = Promise<{ data: T[] | null; error: SupabaseMaybeError }>;
type DateFilter = { start: string | null; end: string | null; label: string };

type LegacyExportOption = {
  id: LegacyExportType;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
};

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

const EXPORT_PAGE_SIZE = 1000;
const CSV_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

const legacyExportOptions: LegacyExportOption[] = [
  {
    id: "users",
    label: "User Profile Snapshot",
    description: "Quick local CSV of profile fields, verification state, registration counts, and vibes.",
    icon: Users,
    color: "from-primary to-accent",
  },
  {
    id: "matches",
    label: "Match Statistics",
    description: "Quick local CSV of match rows with participant names and message counts.",
    icon: Heart,
    color: "from-pink-500 to-rose-600",
  },
  {
    id: "events",
    label: "Event Registrations",
    description: "Quick local CSV of event rows with registration and attended-flag counts.",
    icon: Calendar,
    color: "from-orange-500 to-amber-600",
  },
  {
    id: "reports",
    label: "User Reports",
    description: "Quick local CSV of report rows with reporter/reported names and review status.",
    icon: FileText,
    color: "from-red-500 to-rose-600",
  },
  {
    id: "activity_logs",
    label: "Activity Logs",
    description: "Quick local CSV of admin activity logs for short-term internal review.",
    icon: FileSpreadsheet,
    color: "from-blue-500 to-cyan-600",
  },
];

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

function throwIfError(error: SupabaseMaybeError, fallback: string) {
  if (error) throw new Error(error.message || fallback);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchAllPages<T>(fetchPage: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    const to = from + EXPORT_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    throwIfError(error, "Export page failed");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) break;
  }
  return rows;
}

function sanitizeCsvValue(value: ExportCell): string {
  const text = String(value ?? "");
  const formulaCandidate = text.trimStart();
  const safe = CSV_FORMULA_PREFIXES.some((prefix) => formulaCandidate.startsWith(prefix)) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  const [selectedLegacyType, setSelectedLegacyType] = useState<LegacyExportType | null>(null);
  const [isLegacyExporting, setIsLegacyExporting] = useState(false);
  const [legacyExportSuccess, setLegacyExportSuccess] = useState<LegacyExportType | null>(null);
  const [legacyResult, setLegacyResult] = useState<{ type: LegacyExportType; rows: number } | null>(null);

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

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const generatePrintableHtml = (title: string, headers: string[], rows: ExportCell[][]): string => {
    const tableRows = rows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell ?? ""))}</td>`).join("")}</tr>`)
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th { background-color: #8b5cf6; color: white; padding: 12px 8px; text-align: left; }
    td { border: 1px solid #ddd; padding: 8px; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    .meta { color: #666; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Generated: ${format(new Date(), "yyyy-MM-dd HH:mm:ss")} | Records: ${rows.length}</p>
  <table>
    <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <script>window.print();</script>
</body>
</html>`;
  };

  const downloadData = (headers: string[], rows: ExportCell[][], filename: string, title: string): number => {
    if (exportFormat === "csv") {
      const csv = [headers.map(sanitizeCsvValue).join(","), ...rows.map((row) => row.map(sanitizeCsvValue).join(","))].join("\n");
      downloadFile(csv, `${filename}.csv`, "text/csv;charset=utf-8;");
    } else {
      const htmlContent = generatePrintableHtml(title, headers, rows);
      const printWindow = window.open("", "_blank");
      if (!printWindow) throw new Error("Printable window was blocked by the browser.");
      printWindow.document.write(htmlContent);
      printWindow.document.close();
    }
    return rows.length;
  };

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
      if (error) throw new Error(error.message || "Governed export queue failed");
      const payload = data as GovernedExportResponse | null;
      if (!payload || payload.success === false || payload.ok === false) {
        throw new Error(payload?.message || payload?.error || "Governed export queue failed");
      }
      setQueuedJob(payload);
      await exportJobs.refetch();
      toast.success("Governed export queued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to queue governed export");
    } finally {
      setIsQueueing(false);
    }
  };

  const exportUsers = async (): Promise<number> => {
    const fetchPage = (from: number, to: number) => {
      let query = supabase
        .from("profiles")
        .select(`
          id,
          name,
          age,
          gender,
          location,
          height_cm,
          looking_for,
          relationship_intent,
          email_verified,
          photo_verified,
          is_suspended,
          total_matches,
          total_conversations,
          created_at,
          updated_at
        `)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (dateFilter.start) query = query.gte("created_at", dateFilter.start);
      if (dateFilter.end) query = query.lte("created_at", dateFilter.end);
      return query as unknown as PageResult<{
        id: string;
        name: string;
        age: number;
        gender: string;
        location: string | null;
        height_cm: number | null;
        looking_for: string | null;
        relationship_intent: string | null;
        email_verified: boolean | null;
        photo_verified: boolean | null;
        is_suspended: boolean | null;
        total_matches: number | null;
        total_conversations: number | null;
        created_at: string;
        updated_at: string;
      }>;
    };
    const data = await fetchAllPages(fetchPage);

    const eventCounts: Record<string, number> = {};
    for (const ids of chunkArray(data.map((user) => user.id), 200)) {
      const rows = await fetchAllPages<{ profile_id: string }>((from, to) =>
        supabase
          .from("event_registrations")
          .select("profile_id")
          .in("profile_id", ids)
          .order("profile_id", { ascending: true })
          .range(from, to) as unknown as PageResult<{ profile_id: string }>,
      );
      rows.forEach((row) => {
        eventCounts[row.profile_id] = (eventCounts[row.profile_id] ?? 0) + 1;
      });
    }

    const vibesByUser: Record<string, string[]> = {};
    for (const ids of chunkArray(data.map((user) => user.id), 200)) {
      const rows = await fetchAllPages<ProfileVibeExportRow>((from, to) =>
        supabase
          .from("profile_vibes")
          .select("profile_id, vibe_tags (label)")
          .in("profile_id", ids)
          .order("profile_id", { ascending: true })
          .range(from, to) as unknown as PageResult<ProfileVibeExportRow>,
      );
      rows.forEach((v) => {
        if (!vibesByUser[v.profile_id]) vibesByUser[v.profile_id] = [];
        const vibeTags = Array.isArray(v.vibe_tags) ? v.vibe_tags : v.vibe_tags ? [v.vibe_tags] : [];
        vibeTags.forEach((tag) => {
          if (tag.label) vibesByUser[v.profile_id].push(tag.label);
        });
      });
    }

    const headers = [
      "ID", "Name", "Age", "Gender", "Location", "Height (cm)", "Relationship Intent",
      "Email Verified", "Photo Verified", "Suspended", "Total Matches",
      "Total Conversations", "Event Registration Count", "Vibes", "Created At", "Updated At",
    ];

    const rows = data.map((user) => [
      user.id,
      user.name,
      user.age,
      user.gender,
      user.location || "",
      user.height_cm || "",
      normalizeRelationshipIntentId(user.relationship_intent || user.looking_for) || "",
      user.email_verified ? "Yes" : "No",
      user.photo_verified ? "Yes" : "No",
      user.is_suspended ? "Yes" : "No",
      user.total_matches || 0,
      user.total_conversations || 0,
      eventCounts[user.id] || 0,
      vibesByUser[user.id]?.join("; ") || "",
      formatDateTime(user.created_at),
      formatDateTime(user.updated_at),
    ]);

    return downloadData(headers, rows, `vibely_users_${format(new Date(), "yyyy-MM-dd")}`, "User Profile Snapshot Export");
  };

  const exportMatches = async (): Promise<number> => {
    const matches = await fetchAllPages<{
      id: string;
      profile_id_1: string;
      profile_id_2: string;
      matched_at: string;
      last_message_at: string | null;
      archived_at?: string | null;
    }>((from, to) => {
      let query = supabase.from("matches").select("*").order("matched_at", { ascending: false }).range(from, to);
      if (dateFilter.start) query = query.gte("matched_at", dateFilter.start);
      if (dateFilter.end) query = query.lte("matched_at", dateFilter.end);
      return query as unknown as PageResult<{
        id: string;
        profile_id_1: string;
        profile_id_2: string;
        matched_at: string;
        last_message_at: string | null;
        archived_at?: string | null;
      }>;
    });

    const profileIds = [...new Set(matches.flatMap((m) => [m.profile_id_1, m.profile_id_2]))];
    const profileMap: Record<string, string> = {};
    for (const ids of chunkArray(profileIds, 200)) {
      const profiles = await fetchAllPages<{ id: string; name: string }>((from, to) =>
        supabase
          .from("profiles")
          .select("id, name")
          .in("id", ids)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PageResult<{ id: string; name: string }>,
      );
      profiles.forEach((p) => {
        profileMap[p.id] = p.name;
      });
    }

    const messageCounts: Record<string, number> = {};
    for (const ids of chunkArray(matches.map((m) => m.id), 200)) {
      const messages = await fetchAllPages<{ match_id: string }>((from, to) =>
        supabase
          .from("messages")
          .select("match_id")
          .in("match_id", ids)
          .order("match_id", { ascending: true })
          .range(from, to) as unknown as PageResult<{ match_id: string }>,
      );
      messages.forEach((message) => {
        messageCounts[message.match_id] = (messageCounts[message.match_id] ?? 0) + 1;
      });
    }

    const headers = ["Match ID", "User 1", "User 2", "Messages Count", "Matched At", "Last Message At", "Archived"];
    const rows = matches.map((match) => [
      match.id,
      profileMap[match.profile_id_1] || match.profile_id_1,
      profileMap[match.profile_id_2] || match.profile_id_2,
      messageCounts[match.id] || 0,
      formatDateTime(match.matched_at),
      formatDateTime(match.last_message_at),
      match.archived_at ? "Yes" : "No",
    ]);

    return downloadData(headers, rows, `vibely_matches_${format(new Date(), "yyyy-MM-dd")}`, "Match Statistics Export");
  };

  const exportEvents = async (): Promise<number> => {
    const events = await fetchAllPages<{
      id: string;
      title: string;
      description: string | null;
      event_date: string;
      duration_minutes: number | null;
      max_attendees: number | null;
      current_attendees: number | null;
      tags: string[] | null;
      status: string | null;
      is_free?: boolean | null;
      price_amount?: number | null;
      price_currency?: string | null;
      created_at: string;
    }>((from, to) => {
      let query = supabase.from("events").select("*").order("event_date", { ascending: false }).range(from, to);
      if (dateFilter.start) query = query.gte("event_date", dateFilter.start);
      if (dateFilter.end) query = query.lte("event_date", dateFilter.end);
      return query as unknown as PageResult<{
        id: string;
        title: string;
        description: string | null;
        event_date: string;
        duration_minutes: number | null;
        max_attendees: number | null;
        current_attendees: number | null;
        tags: string[] | null;
        status: string | null;
        is_free?: boolean | null;
        price_amount?: number | null;
        price_currency?: string | null;
        created_at: string;
      }>;
    });

    const regsByEvent: Record<string, { total: number; attended: number }> = {};
    for (const ids of chunkArray(events.map((event) => event.id), 200)) {
      const registrations = await fetchAllPages<{ event_id: string; attended: boolean | null }>((from, to) =>
        supabase
          .from("event_registrations")
          .select("event_id, attended")
          .in("event_id", ids)
          .order("event_id", { ascending: true })
          .range(from, to) as unknown as PageResult<{ event_id: string; attended: boolean | null }>,
      );
      registrations.forEach((r) => {
        if (!regsByEvent[r.event_id]) regsByEvent[r.event_id] = { total: 0, attended: 0 };
        regsByEvent[r.event_id].total += 1;
        if (r.attended) regsByEvent[r.event_id].attended += 1;
      });
    }

    const headers = [
      "Event ID", "Title", "Description", "Date", "Duration (min)", "Max Attendees",
      "Current Attendees", "Registration Count", "Attended Flag Count", "Tags", "Status",
      "Is Free", "Price", "Created At",
    ];
    const rows = events.map((event) => [
      event.id,
      event.title,
      event.description || "",
      format(new Date(event.event_date), "yyyy-MM-dd HH:mm"),
      event.duration_minutes || "",
      event.max_attendees || "",
      event.current_attendees || 0,
      regsByEvent[event.id]?.total || 0,
      regsByEvent[event.id]?.attended || 0,
      event.tags?.join("; ") || "",
      event.status || "upcoming",
      event.is_free ? "Yes" : "No",
      event.is_free ? "Free" : `${event.price_amount ?? ""} ${event.price_currency ?? ""}`.trim(),
      formatDateTime(event.created_at),
    ]);

    return downloadData(headers, rows, `vibely_event_registrations_${format(new Date(), "yyyy-MM-dd")}`, "Event Registrations Export");
  };

  const exportReports = async (): Promise<number> => {
    const reports = await fetchAllPages<{
      id: string;
      reporter_id: string;
      reported_id: string;
      reason: string;
      details: string | null;
      status: string;
      action_taken: string | null;
      also_blocked: boolean | null;
      created_at: string;
      reviewed_at: string | null;
    }>((from, to) => {
      let query = supabase.from("user_reports").select("*").order("created_at", { ascending: false }).range(from, to);
      if (dateFilter.start) query = query.gte("created_at", dateFilter.start);
      if (dateFilter.end) query = query.lte("created_at", dateFilter.end);
      return query as unknown as PageResult<{
        id: string;
        reporter_id: string;
        reported_id: string;
        reason: string;
        details: string | null;
        status: string;
        action_taken: string | null;
        also_blocked: boolean | null;
        created_at: string;
        reviewed_at: string | null;
      }>;
    });

    const profileIds = [...new Set(reports.flatMap((r) => [r.reporter_id, r.reported_id]))];
    const profileMap: Record<string, string> = {};
    for (const ids of chunkArray(profileIds, 200)) {
      const profiles = await fetchAllPages<{ id: string; name: string }>((from, to) =>
        supabase
          .from("profiles")
          .select("id, name")
          .in("id", ids)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PageResult<{ id: string; name: string }>,
      );
      profiles.forEach((p) => {
        profileMap[p.id] = p.name;
      });
    }

    const headers = [
      "Report ID", "Reporter", "Reported User", "Reason", "Details",
      "Status", "Action Taken", "Also Blocked", "Created At", "Reviewed At",
    ];
    const rows = reports.map((report) => [
      report.id,
      profileMap[report.reporter_id] || report.reporter_id,
      profileMap[report.reported_id] || report.reported_id,
      report.reason,
      report.details || "",
      report.status,
      report.action_taken || "",
      report.also_blocked ? "Yes" : "No",
      formatDateTime(report.created_at),
      formatDateTime(report.reviewed_at),
    ]);

    return downloadData(headers, rows, `vibely_reports_${format(new Date(), "yyyy-MM-dd")}`, "User Reports Export");
  };

  const exportActivityLogs = async (): Promise<number> => {
    const logs = await fetchAllPages<{
      id: string;
      admin_id: string;
      action_type: string;
      target_type: string;
      target_id: string | null;
      details: Record<string, unknown> | null;
      created_at: string;
    }>((from, to) => {
      let query = supabase.from("admin_activity_logs").select("*").order("created_at", { ascending: false }).range(from, to);
      if (dateFilter.start) query = query.gte("created_at", dateFilter.start);
      if (dateFilter.end) query = query.lte("created_at", dateFilter.end);
      return query as unknown as PageResult<{
        id: string;
        admin_id: string;
        action_type: string;
        target_type: string;
        target_id: string | null;
        details: Record<string, unknown> | null;
        created_at: string;
      }>;
    });

    const profileMap: Record<string, string> = {};
    for (const ids of chunkArray([...new Set(logs.map((l) => l.admin_id))], 200)) {
      const profiles = await fetchAllPages<{ id: string; name: string }>((from, to) =>
        supabase
          .from("profiles")
          .select("id, name")
          .in("id", ids)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PageResult<{ id: string; name: string }>,
      );
      profiles.forEach((p) => {
        profileMap[p.id] = p.name;
      });
    }

    const headers = ["Log ID", "Admin", "Action Type", "Target Type", "Target ID", "Details", "Created At"];
    const rows = logs.map((log) => [
      log.id,
      profileMap[log.admin_id] || log.admin_id,
      log.action_type,
      log.target_type,
      log.target_id || "",
      log.details ? JSON.stringify(log.details) : "",
      formatDateTime(log.created_at),
    ]);

    return downloadData(headers, rows, `vibely_activity_logs_${format(new Date(), "yyyy-MM-dd")}`, "Admin Activity Logs Export");
  };

  const handleLegacyExport = async (type: LegacyExportType) => {
    if (hasInvalidDateRange) {
      toast.error(isCustomRangeReversed ? "Custom start date must be before the end date." : "Both custom dates are required.");
      return;
    }
    setSelectedLegacyType(type);
    setIsLegacyExporting(true);
    setLegacyExportSuccess(null);

    try {
      const rowCount =
        type === "users"
          ? await exportUsers()
          : type === "matches"
            ? await exportMatches()
            : type === "events"
              ? await exportEvents()
              : type === "reports"
                ? await exportReports()
                : await exportActivityLogs();
      setLegacyExportSuccess(type);
      setLegacyResult({ type, rows: rowCount });
      toast.success(`Local export generated ${rowCount.toLocaleString()} rows`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export data");
    } finally {
      setIsLegacyExporting(false);
      setSelectedLegacyType(null);
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
        <AlertTitle>Governed export queue is the default</AlertTitle>
        <AlertDescription>
          Queued exports require a reason, permission, PII classification, audit log, and expiry. File generation is a controlled worker step; local CSV is a legacy review tool only.
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

          {hasInvalidDateRange ? (
            <Alert className="border-amber-500/30 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Custom date range required</AlertTitle>
              <AlertDescription>
                {isCustomRangeReversed
                  ? "The custom start date must be before the end date."
                  : "Select both custom dates before queueing or downloading an export. The panel will not fall back to all-time data."}
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

          <Button onClick={queueGovernedExport} disabled={isQueueing || compliancePermission.isLoading || hasCompliancePermission === false || hasInvalidDateRange || isPiiBelowScopeMinimum} className="w-full gap-2">
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

      <div className="glass-card p-4 rounded-2xl space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Legacy Quick Local Export</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Browser-generated CSV/printable HTML for short internal review. This path is not compliance-grade, is not audited as an export job, and may be partial if browser/network limits are hit.
            </p>
          </div>
          <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">Legacy</Badge>
        </div>

        {legacyResult ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            Last local export generated {legacyResult.rows.toLocaleString()} rows for {legacyResult.type}. This did not create a governed export job.
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {legacyExportOptions.map((option) => {
            const Icon = option.icon;
            const isLoading = isLegacyExporting && selectedLegacyType === option.id;
            const wasSuccessful = legacyExportSuccess === option.id;
            return (
              <motion.div key={option.id} whileHover={{ scale: 1.02 }} className="glass-card p-6 rounded-2xl">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${option.color} flex items-center justify-center`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  {wasSuccessful ? (
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Exported
                    </Badge>
                  ) : null}
                </div>

                <h3 className="text-lg font-semibold text-foreground mb-1">{option.label}</h3>
                <p className="text-sm text-muted-foreground mb-4">{option.description}</p>

                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => setSelectedLegacyType(option.id)}
                  disabled={isLegacyExporting || compliancePermission.isLoading || hasCompliancePermission === false || hasInvalidDateRange}
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {hasCompliancePermission === false ? "Permission required" : `Quick ${exportFormat === "csv" ? "CSV" : "Printable HTML"}`}
                </Button>
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="glass-card p-4 rounded-2xl">
        <div className="flex items-start gap-3">
          <History className="w-5 h-5 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-sm text-foreground font-medium">Export Information</p>
            <p className="text-xs text-muted-foreground">
              Governed exports are the export-of-record path. Local CSV values are spreadsheet-formula escaped, paginated in browser batches, and intended only for scoped review. Printable HTML opens a print dialog so an admin can save as PDF locally.
            </p>
          </div>
        </div>
      </div>

      <AdminConfirmDialog
        open={!!selectedLegacyType && !isLegacyExporting}
        onOpenChange={(open) => {
          if (!open) setSelectedLegacyType(null);
        }}
        title="Run legacy local export?"
        description={`This creates a browser-local ${exportFormat === "csv" ? "CSV" : "printable HTML"} download only.\n\nIt does not create a data_export_jobs row, does not create an expiring private file, and is not the compliance export-of-record. Use the governed queue for DSAR, legal, compliance, or incident evidence exports.`}
        confirmLabel="Run Local Export"
        variant="outline"
        isPending={isLegacyExporting}
        onConfirm={() => selectedLegacyType ? handleLegacyExport(selectedLegacyType) : undefined}
      />
    </motion.div>
  );
};

export default AdminExportPanel;
