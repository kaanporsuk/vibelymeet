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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, subDays, subMonths } from "date-fns";

type ExportType = "users" | "matches" | "events";

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
];

const AdminExportPanel = () => {
  const [selectedType, setSelectedType] = useState<ExportType | null>(null);
  const [dateRange, setDateRange] = useState("all");
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<ExportType | null>(null);

  const getDateFilter = () => {
    const now = new Date();
    switch (dateRange) {
      case "7d":
        return subDays(now, 7).toISOString();
      case "30d":
        return subDays(now, 30).toISOString();
      case "90d":
        return subDays(now, 90).toISOString();
      case "1y":
        return subMonths(now, 12).toISOString();
      default:
        return null;
    }
  };

  const downloadCSV = (data: string, filename: string) => {
    const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportUsers = async () => {
    const dateFilter = getDateFilter();
    
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
        email_verified,
        photo_verified,
        is_suspended,
        total_matches,
        total_conversations,
        events_attended,
        created_at,
        updated_at
      `);

    if (dateFilter) {
      query = query.gte("created_at", dateFilter);
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
      "ID",
      "Name",
      "Age",
      "Gender",
      "Location",
      "Height (cm)",
      "Looking For",
      "Email Verified",
      "Photo Verified",
      "Suspended",
      "Total Matches",
      "Total Conversations",
      "Events Attended",
      "Vibes",
      "Created At",
      "Updated At",
    ];

    const rows = data?.map((user) => [
      user.id,
      user.name,
      user.age,
      user.gender,
      user.location || "",
      user.height_cm || "",
      user.looking_for || "",
      user.email_verified ? "Yes" : "No",
      user.photo_verified ? "Yes" : "No",
      user.is_suspended ? "Yes" : "No",
      user.total_matches || 0,
      user.total_conversations || 0,
      user.events_attended || 0,
      vibesByUser[user.id]?.join("; ") || "",
      format(new Date(user.created_at), "yyyy-MM-dd HH:mm:ss"),
      format(new Date(user.updated_at), "yyyy-MM-dd HH:mm:ss"),
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    downloadCSV(csv, `vibely_users_${format(new Date(), "yyyy-MM-dd")}.csv`);
  };

  const exportMatches = async () => {
    const dateFilter = getDateFilter();

    let query = supabase.from("matches").select("*");

    if (dateFilter) {
      query = query.gte("matched_at", dateFilter);
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

    // Fetch message counts
    const messageCounts: Record<string, number> = {};
    for (const match of matches || []) {
      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("match_id", match.id);
      messageCounts[match.id] = count || 0;
    }

    const headers = [
      "Match ID",
      "User 1",
      "User 2",
      "Messages Count",
      "Matched At",
      "Last Message At",
      "Archived",
    ];

    const rows = matches?.map((match) => [
      match.id,
      profileMap[match.profile_id_1] || match.profile_id_1,
      profileMap[match.profile_id_2] || match.profile_id_2,
      messageCounts[match.id] || 0,
      format(new Date(match.matched_at), "yyyy-MM-dd HH:mm:ss"),
      match.last_message_at ? format(new Date(match.last_message_at), "yyyy-MM-dd HH:mm:ss") : "",
      match.archived_at ? "Yes" : "No",
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    downloadCSV(csv, `vibely_matches_${format(new Date(), "yyyy-MM-dd")}.csv`);
  };

  const exportEvents = async () => {
    const dateFilter = getDateFilter();

    let query = supabase.from("events").select("*");

    if (dateFilter) {
      query = query.gte("event_date", dateFilter);
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
      "Event ID",
      "Title",
      "Description",
      "Date",
      "Duration (min)",
      "Max Attendees",
      "Current Attendees",
      "Registrations",
      "Actually Attended",
      "Tags",
      "Status",
      "Created At",
    ];

    const rows = events?.map((event) => [
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
      format(new Date(event.created_at), "yyyy-MM-dd HH:mm:ss"),
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    downloadCSV(csv, `vibely_events_${format(new Date(), "yyyy-MM-dd")}.csv`);
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
      {/* Date Range Filter */}
      <div className="glass-card p-4 rounded-2xl">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-muted-foreground">Date Range:</span>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[180px] bg-secondary/50">
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
              <SelectItem value="1y">Last Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Export Options */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                {isLoading ? "Exporting..." : "Export CSV"}
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
            <p className="text-sm text-foreground font-medium">Export Format</p>
            <p className="text-xs text-muted-foreground">
              All exports are in CSV format, compatible with Excel, Google Sheets, and other
              spreadsheet applications. Personal data is included - handle with care.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default AdminExportPanel;