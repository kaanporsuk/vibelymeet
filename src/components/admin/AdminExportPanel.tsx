import { useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  FileText,
  Users,
  Heart,
  Calendar,
  Loader2,
  CheckCircle,
  FileSpreadsheet,
  File,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, subDays, subMonths, parseISO, isWithinInterval } from "date-fns";

type ExportType = "users" | "matches" | "events" | "reports" | "activity_logs";
type ExportFormat = "csv" | "pdf";

interface ExportOption {
  id: ExportType;
  label: string;
  description: string;
  icon: any;
  color: string;
}

const exportOptions: ExportOption[] = [
  {
    id: "users",
    label: "User Data",
    description: "Export all user profiles with vibes and verification status",
    icon: Users,
    color: "from-primary to-accent",
  },
  {
    id: "matches",
    label: "Match Statistics",
    description: "Export match data with message counts and timestamps",
    icon: Heart,
    color: "from-pink-500 to-rose-600",
  },
  {
    id: "events",
    label: "Event Attendance",
    description: "Export event data with registration counts and attendee lists",
    icon: Calendar,
    color: "from-orange-500 to-amber-600",
  },
  {
    id: "reports",
    label: "User Reports",
    description: "Export all user reports with status and resolution details",
    icon: FileText,
    color: "from-red-500 to-rose-600",
  },
  {
    id: "activity_logs",
    label: "Activity Logs",
    description: "Export admin activity logs for audit purposes",
    icon: FileSpreadsheet,
    color: "from-blue-500 to-cyan-600",
  },
];

const AdminExportPanel = () => {
  const [selectedType, setSelectedType] = useState<ExportType | null>(null);
  const [dateRange, setDateRange] = useState("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<ExportType | null>(null);

  const getDateFilter = (): { start: string | null; end: string | null } => {
    const now = new Date();
    const end = now.toISOString();
    
    if (dateRange === "custom" && customStartDate && customEndDate) {
      return { 
        start: new Date(customStartDate).toISOString(), 
        end: new Date(customEndDate + 'T23:59:59').toISOString() 
      };
    }
    
    switch (dateRange) {
      case "7d":
        return { start: subDays(now, 7).toISOString(), end };
      case "30d":
        return { start: subDays(now, 30).toISOString(), end };
      case "90d":
        return { start: subDays(now, 90).toISOString(), end };
      case "1y":
        return { start: subMonths(now, 12).toISOString(), end };
      default:
        return { start: null, end: null };
    }
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // HTML escape function to prevent XSS
  const escapeHtml = (str: string): string => {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const generatePDFContent = (title: string, headers: string[], rows: any[][]): string => {
    // Generate a simple HTML table that can be printed as PDF
    // All content is escaped to prevent XSS attacks
    const tableRows = rows.map(row => 
      `<tr>${row.map(cell => `<td style="border: 1px solid #ddd; padding: 8px;">${escapeHtml(String(cell))}</td>`).join('')}</tr>`
    ).join('');
    
    return `
      <!DOCTYPE html>
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
        <p class="meta">Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')} | Records: ${rows.length}</p>
        <table>
          <thead>
            <tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        <script>window.print();</script>
      </body>
      </html>
    `;
  };

  const downloadData = (headers: string[], rows: any[][], filename: string, title: string) => {
    if (exportFormat === "csv") {
      const csv = [
        headers.join(","),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
      ].join("\n");
      downloadFile(csv, `${filename}.csv`, "text/csv;charset=utf-8;");
    } else {
      const htmlContent = generatePDFContent(title, headers, rows);
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close();
      }
    }
  };

  const exportUsers = async () => {
    const { start, end } = getDateFilter();
    
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
        events_attended,
        created_at,
        updated_at
      `);

    if (start) {
      query = query.gte("created_at", start);
    }
    if (end) {
      query = query.lte("created_at", end);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Fetch vibes for all users
    const { data: vibesData } = await supabase
      .from("profile_vibes")
      .select(`
        profile_id,
        vibe_tags (label)
      `);

    const vibesByUser: Record<string, string[]> = {};
    vibesData?.forEach((v) => {
      if (!vibesByUser[v.profile_id]) vibesByUser[v.profile_id] = [];
      if (v.vibe_tags) vibesByUser[v.profile_id].push((v.vibe_tags as any).label);
    });

    const headers = [
      "ID", "Name", "Age", "Gender", "Location", "Height (cm)", "Relationship Intent",
      "Email Verified", "Photo Verified", "Suspended", "Total Matches",
      "Total Conversations", "Events Attended", "Vibes", "Created At", "Updated At",
    ];

    const rows = data?.map((user) => [
      user.id, user.name, user.age, user.gender, user.location || "",
      user.height_cm || "", user.relationship_intent || user.looking_for || "",
      user.email_verified ? "Yes" : "No", user.photo_verified ? "Yes" : "No",
      user.is_suspended ? "Yes" : "No", user.total_matches || 0,
      user.total_conversations || 0, user.events_attended || 0,
      vibesByUser[user.id]?.join("; ") || "",
      format(new Date(user.created_at), "yyyy-MM-dd HH:mm:ss"),
      format(new Date(user.updated_at), "yyyy-MM-dd HH:mm:ss"),
    ]) || [];

    downloadData(headers, rows, `vibely_users_${format(new Date(), "yyyy-MM-dd")}`, "User Data Export");
  };

  const exportMatches = async () => {
    const { start, end } = getDateFilter();

    let query = supabase.from("matches").select("*");

    if (start) {
      query = query.gte("matched_at", start);
    }
    if (end) {
      query = query.lte("matched_at", end);
    }

    const { data: matches, error } = await query;
    if (error) throw error;

    // Fetch profiles
    const userIds = new Set<string>();
    matches?.forEach((m) => {
      userIds.add(m.profile_id_1);
      userIds.add(m.profile_id_2);
    });

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", Array.from(userIds));

    const profileMap: Record<string, string> = {};
    profiles?.forEach((p) => {
      profileMap[p.id] = p.name;
    });

    // Fetch message counts in batch
    const matchIds = matches?.map(m => m.id) || [];
    const messageCounts: Record<string, number> = {};
    
    if (matchIds.length > 0) {
      for (const matchId of matchIds) {
        const { count } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("match_id", matchId);
        messageCounts[matchId] = count || 0;
      }
    }

    const headers = [
      "Match ID", "User 1", "User 2", "Messages Count",
      "Matched At", "Last Message At", "Archived",
    ];

    const rows = matches?.map((match) => [
      match.id, profileMap[match.profile_id_1] || match.profile_id_1,
      profileMap[match.profile_id_2] || match.profile_id_2,
      messageCounts[match.id] || 0,
      format(new Date(match.matched_at), "yyyy-MM-dd HH:mm:ss"),
      match.last_message_at ? format(new Date(match.last_message_at), "yyyy-MM-dd HH:mm:ss") : "",
      match.archived_at ? "Yes" : "No",
    ]) || [];

    downloadData(headers, rows, `vibely_matches_${format(new Date(), "yyyy-MM-dd")}`, "Match Statistics Export");
  };

  const exportEvents = async () => {
    const { start, end } = getDateFilter();

    let query = supabase.from("events").select("*");

    if (start) {
      query = query.gte("event_date", start);
    }
    if (end) {
      query = query.lte("event_date", end);
    }

    const { data: events, error } = await query.order("event_date", { ascending: false });
    if (error) throw error;

    // Fetch registrations
    const { data: registrations } = await supabase
      .from("event_registrations")
      .select("event_id, profile_id, attended");

    const regsByEvent: Record<string, { total: number; attended: number }> = {};
    registrations?.forEach((r) => {
      if (!regsByEvent[r.event_id]) regsByEvent[r.event_id] = { total: 0, attended: 0 };
      regsByEvent[r.event_id].total++;
      if (r.attended) regsByEvent[r.event_id].attended++;
    });

    const headers = [
      "Event ID", "Title", "Description", "Date", "Duration (min)",
      "Max Attendees", "Current Attendees", "Registrations", "Actually Attended",
      "Tags", "Status", "Is Free", "Price", "Created At",
    ];

    const rows = events?.map((event) => [
      event.id, event.title, event.description || "",
      format(new Date(event.event_date), "yyyy-MM-dd HH:mm"),
      event.duration_minutes || "", event.max_attendees || "",
      event.current_attendees || 0, regsByEvent[event.id]?.total || 0,
      regsByEvent[event.id]?.attended || 0, event.tags?.join("; ") || "",
      event.status || "upcoming", event.is_free ? "Yes" : "No",
      event.is_free ? "Free" : `${event.price_amount} ${event.price_currency}`,
      format(new Date(event.created_at), "yyyy-MM-dd HH:mm:ss"),
    ]) || [];

    downloadData(headers, rows, `vibely_events_${format(new Date(), "yyyy-MM-dd")}`, "Event Attendance Export");
  };

  const exportReports = async () => {
    const { start, end } = getDateFilter();

    let query = supabase.from("user_reports").select("*");

    if (start) {
      query = query.gte("created_at", start);
    }
    if (end) {
      query = query.lte("created_at", end);
    }

    const { data: reports, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;

    // Fetch user names
    const userIds = new Set<string>();
    reports?.forEach((r) => {
      userIds.add(r.reporter_id);
      userIds.add(r.reported_id);
    });

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", Array.from(userIds));

    const profileMap: Record<string, string> = {};
    profiles?.forEach((p) => {
      profileMap[p.id] = p.name;
    });

    const headers = [
      "Report ID", "Reporter", "Reported User", "Reason", "Details",
      "Status", "Action Taken", "Also Blocked", "Created At", "Reviewed At",
    ];

    const rows = reports?.map((report) => [
      report.id, profileMap[report.reporter_id] || report.reporter_id,
      profileMap[report.reported_id] || report.reported_id,
      report.reason, report.details || "", report.status,
      report.action_taken || "", report.also_blocked ? "Yes" : "No",
      format(new Date(report.created_at), "yyyy-MM-dd HH:mm:ss"),
      report.reviewed_at ? format(new Date(report.reviewed_at), "yyyy-MM-dd HH:mm:ss") : "",
    ]) || [];

    downloadData(headers, rows, `vibely_reports_${format(new Date(), "yyyy-MM-dd")}`, "User Reports Export");
  };

  const exportActivityLogs = async () => {
    const { start, end } = getDateFilter();

    let query = supabase.from("admin_activity_logs").select("*");

    if (start) {
      query = query.gte("created_at", start);
    }
    if (end) {
      query = query.lte("created_at", end);
    }

    const { data: logs, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;

    // Fetch admin names
    const adminIds = new Set<string>();
    logs?.forEach((l) => adminIds.add(l.admin_id));

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", Array.from(adminIds));

    const profileMap: Record<string, string> = {};
    profiles?.forEach((p) => {
      profileMap[p.id] = p.name;
    });

    const headers = [
      "Log ID", "Admin", "Action Type", "Target Type", "Target ID", "Details", "Created At",
    ];

    const rows = logs?.map((log) => [
      log.id, profileMap[log.admin_id] || log.admin_id,
      log.action_type, log.target_type, log.target_id || "",
      log.details ? JSON.stringify(log.details) : "",
      format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss"),
    ]) || [];

    downloadData(headers, rows, `vibely_activity_logs_${format(new Date(), "yyyy-MM-dd")}`, "Admin Activity Logs Export");
  };

  const handleExport = async (type: ExportType) => {
    setSelectedType(type);
    setIsExporting(true);
    setExportSuccess(null);

    try {
      switch (type) {
        case "users":
          await exportUsers();
          break;
        case "matches":
          await exportMatches();
          break;
        case "events":
          await exportEvents();
          break;
        case "reports":
          await exportReports();
          break;
        case "activity_logs":
          await exportActivityLogs();
          break;
      }
      setExportSuccess(type);
      toast.success("Export completed successfully");
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export data");
    } finally {
      setIsExporting(false);
      setSelectedType(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Filters */}
      <div className="glass-card p-4 rounded-2xl space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Export Settings</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Date Range */}
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
          </div>

          {/* Export Format */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Format</Label>
            <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as ExportFormat)}>
              <SelectTrigger className="bg-secondary/50">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4" />
                    CSV (Excel Compatible)
                  </div>
                </SelectItem>
                <SelectItem value="pdf">
                  <div className="flex items-center gap-2">
                    <File className="w-4 h-4" />
                    PDF (Printable)
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Custom Date Range */}
        {dateRange === "custom" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Start Date</Label>
              <Input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-secondary/50"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">End Date</Label>
              <Input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-secondary/50"
              />
            </div>
          </div>
        )}
      </div>

      {/* Export Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {exportOptions.map((option) => {
          const Icon = option.icon;
          const isLoading = isExporting && selectedType === option.id;
          const wasSuccessful = exportSuccess === option.id;

          return (
            <motion.div
              key={option.id}
              whileHover={{ scale: 1.02 }}
              className="glass-card p-6 rounded-2xl"
            >
              <div className="flex items-start justify-between mb-4">
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${option.color} flex items-center justify-center`}
                >
                  <Icon className="w-6 h-6 text-white" />
                </div>
                {wasSuccessful && (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Exported
                  </Badge>
                )}
              </div>

              <h3 className="text-lg font-semibold text-foreground mb-1">{option.label}</h3>
              <p className="text-sm text-muted-foreground mb-4">{option.description}</p>

              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => handleExport(option.id)}
                disabled={isExporting}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {isLoading ? "Exporting..." : `Export ${exportFormat.toUpperCase()}`}
              </Button>
            </motion.div>
          );
        })}
      </div>

      {/* Info */}
      <div className="glass-card p-4 rounded-2xl">
        <div className="flex items-start gap-3">
          <FileText className="w-5 h-5 text-muted-foreground mt-0.5" />
          <div>
            <p className="text-sm text-foreground font-medium">Export Information</p>
            <p className="text-xs text-muted-foreground">
              CSV exports are compatible with Excel, Google Sheets, and other spreadsheet applications. 
              PDF exports open in a print dialog for easy printing or saving. 
              Personal data is included - handle with care and in accordance with privacy regulations.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminExportPanel;
