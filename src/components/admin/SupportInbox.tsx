import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Search,
  Smartphone,
  Monitor,
  Send,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { STATUS_CONFIG, PRIORITY_CONFIG, type SupportStatus, type SupportPriority } from "@/lib/supportStatus";
import { SUPPORT_CATEGORIES, type PrimaryType } from "@/lib/supportCategories";
import AdminUserDetailDrawer from "./AdminUserDetailDrawer";

type TicketRow = {
  id: string;
  reference_id: string;
  user_id: string;
  primary_type: string;
  subcategory: string;
  status: string;
  priority: string;
  message: string;
  user_email: string | null;
  platform: string | null;
  app_version: string | null;
  device_model: string | null;
  os_version: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  admin_notes: string | null;
};

type ReplyRow = {
  id: string;
  ticket_id: string;
  sender_type: string;
  sender_id: string | null;
  message: string;
  created_at: string;
};

const PRI_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function platformIcon(platform: string | null) {
  const p = (platform ?? "").toLowerCase();
  if (p === "ios") return "📱";
  if (p === "android") return "🤖";
  if (p === "web") return "🌐";
  return "·";
}

export default function SupportInbox() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [notesDraft, setNotesDraft] = useState("");
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["admin-support-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TicketRow[];
    },
  });

  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);

  const { data: repliesByTicket = {} } = useQuery({
    queryKey: ["admin-support-replies", ticketIds.join(",")],
    queryFn: async () => {
      if (ticketIds.length === 0) return {};
      const { data, error } = await supabase
        .from("support_ticket_replies")
        .select("id, ticket_id, sender_type, created_at")
        .in("ticket_id", ticketIds);
      if (error) throw error;
      const map: Record<string, { sender_type: string; created_at: string }[]> = {};
      for (const r of data ?? []) {
        const row = r as { ticket_id: string; sender_type: string; created_at: string };
        if (!map[row.ticket_id]) map[row.ticket_id] = [];
        map[row.ticket_id].push(row);
      }
      for (const k of Object.keys(map)) {
        map[k].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      }
      return map;
    },
    enabled: ticketIds.length > 0,
  });

  const filtered = useMemo(() => {
    let list = [...tickets];
    if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    if (typeFilter !== "all") list = list.filter((t) => t.primary_type === typeFilter);
    if (priorityFilter !== "all") list = list.filter((t) => t.priority === priorityFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.reference_id.toLowerCase().includes(q) ||
          (t.user_email ?? "").toLowerCase().includes(q) ||
          t.message.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      const pa = PRI_ORDER[a.priority] ?? 9;
      const pb = PRI_ORDER[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return list;
  }, [tickets, statusFilter, typeFilter, priorityFilter, search]);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  const { data: threadReplies = [] } = useQuery({
    queryKey: ["admin-support-thread", selectedId],
    queryFn: async () => {
      if (!selectedId) return [];
      const { data, error } = await supabase
        .from("support_ticket_replies")
        .select("*")
        .eq("ticket_id", selectedId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReplyRow[];
    },
    enabled: !!selectedId,
  });

  const { data: profile } = useQuery({
    queryKey: ["admin-support-profile", selected?.user_id],
    queryFn: async () => {
      if (!selected?.user_id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("name, avatar_url")
        .eq("id", selected.user_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!selected?.user_id,
  });

  const updateTicketMutation = useMutation({
    mutationFn: async (payload: Partial<TicketRow> & { id: string }) => {
      const { id, ...rest } = payload;
      const { error } = await supabase.from("support_tickets").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
      toast.success("Updated");
    },
    onError: () => toast.error("Update failed"),
  });

  const saveNotesMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase.from("support_tickets").update({ admin_notes: notes }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
      toast.success("Notes saved");
    },
    onError: () => toast.error("Failed to save notes"),
  });

  const sendReplyMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !replyText.trim()) return;
      const { error: insErr } = await supabase.from("support_ticket_replies").insert({
        ticket_id: selected.id,
        sender_type: "admin",
        sender_id: null,
        message: replyText.trim(),
      });
      if (insErr) throw insErr;
      const updates: Partial<TicketRow> = {};
      if (selected.status === "submitted") updates.status = "in_review";
      if (Object.keys(updates).length) {
        await supabase.from("support_tickets").update(updates).eq("id", selected.id);
      }
      const { error: fnErr } = await supabase.functions.invoke("send-support-reply", {
        body: {
          ticket_id: selected.id,
          reply_message: replyText.trim(),
          send_email: sendEmail,
        },
      });
      if (fnErr) throw fnErr;
    },
    onSuccess: () => {
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["admin-support-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["admin-support-thread", selectedId] });
      toast.success("Reply sent");
    },
    onError: () => toast.error("Failed to send reply"),
  });

  const needsAttention = (t: TicketRow) => {
    const list = repliesByTicket[t.id] ?? [];
    if (list.length === 0) return t.status === "submitted";
    const last = list[0];
    return last?.sender_type === "user";
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[calc(100vh-8rem)]">
      <div className="w-full lg:w-[380px] flex flex-col border border-border rounded-xl bg-card/40 overflow-hidden">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs w-[130px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="in_review">In review</SelectItem>
                <SelectItem value="waiting_on_user">Waiting on user</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 text-xs w-[120px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="support">Support</SelectItem>
                <SelectItem value="feedback">Feedback</SelectItem>
                <SelectItem value="safety">Safety</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-8 text-xs w-[120px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priority</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ref, email, message…"
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>
        <ScrollArea className="flex-1 max-h-[60vh] lg:max-h-none">
          {isLoading ? (
            <div className="p-6 flex justify-center">
              <Loader2 className="animate-spin w-6 h-6" />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((t) => {
                const pri = PRIORITY_CONFIG[t.priority as SupportPriority] ?? PRIORITY_CONFIG.normal;
                const st = STATUS_CONFIG[t.status as SupportStatus] ?? STATUS_CONFIG.submitted;
                const pt = t.primary_type as PrimaryType;
                const cat = SUPPORT_CATEGORIES[pt];
                const attn = needsAttention(t);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(t.id);
                        setNotesDraft(t.admin_notes ?? "");
                      }}
                      className={`w-full text-left px-3 py-3 hover:bg-secondary/50 transition-colors ${
                        selectedId === t.id ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pri.color }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-sm text-primary">{t.reference_id}</span>
                            {attn ? <span className="w-2 h-2 rounded-full bg-orange-500" title="Needs reply" /> : null}
                          </div>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            <Badge
                              variant="outline"
                              className="text-[10px] h-5"
                              style={{ borderColor: cat?.color ?? "#888", color: cat?.color }}
                            >
                              {cat?.label ?? t.primary_type}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px] h-5">
                              {st.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-1">{t.subcategory}</p>
                          <p className="text-xs text-muted-foreground truncate">{t.user_email ?? "—"}</p>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                            <span title={t.platform ?? ""}>{platformIcon(t.platform)}</span>
                            <span>{formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col border border-border rounded-xl bg-card/30 min-h-[480px]">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground p-8">
            Select a ticket to view details
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center justify-between">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-lg">{selected.reference_id}</span>
                  <Badge
                    variant="outline"
                    style={{
                      borderColor: STATUS_CONFIG[selected.status as SupportStatus]?.color,
                      color: STATUS_CONFIG[selected.status as SupportStatus]?.color,
                    }}
                  >
                    {STATUS_CONFIG[selected.status as SupportStatus]?.label ?? selected.status}
                  </Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Select
                  value={selected.status}
                  onValueChange={(v) =>
                    updateTicketMutation.mutate({
                      id: selected.id,
                      status: v,
                      resolved_at: v === "resolved" ? new Date().toISOString() : null,
                    })
                  }
                >
                  <SelectTrigger className="h-9 w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="in_review">In review</SelectItem>
                    <SelectItem value="waiting_on_user">Waiting on user</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={selected.priority}
                  onValueChange={(v) => updateTicketMutation.mutate({ id: selected.id, priority: v })}
                >
                  <SelectTrigger className="h-9 w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    updateTicketMutation.mutate({
                      id: selected.id,
                      status: "resolved",
                      resolved_at: new Date().toISOString(),
                    })
                  }
                >
                  Mark resolved
                </Button>
              </div>
            </div>

            <div className="p-4 border-b border-border flex flex-wrap gap-4 items-center">
              <Avatar className="h-12 w-12">
                <AvatarImage src={profile?.avatar_url ?? undefined} />
                <AvatarFallback>{(profile?.name ?? "?").slice(0, 2)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{profile?.name ?? "User"}</p>
                <p className="text-sm text-muted-foreground">{selected.user_email ?? "—"}</p>
                <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2 items-center">
                  <span className="inline-flex items-center gap-1">
                    {selected.platform === "web" ? <Monitor className="w-3 h-3" /> : <Smartphone className="w-3 h-3" />}
                    {selected.platform ?? "—"}
                  </span>
                  <span>·</span>
                  <span>{selected.app_version ?? "—"}</span>
                  <span>·</span>
                  <span className="truncate max-w-[200px]">{selected.device_model ?? "—"}</span>
                  <span>·</span>
                  <span>{selected.os_version ?? "—"}</span>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setProfileUserId(selected.user_id)}>
                <ExternalLink className="w-3 h-3" />
                Open profile
              </Button>
            </div>

            <ScrollArea className="flex-1 p-4 max-h-[320px]">
              <div className="rounded-lg border border-border bg-secondary/20 p-3 mb-4">
                <p className="text-xs text-muted-foreground mb-1">Original request</p>
                <p className="text-sm whitespace-pre-wrap">{selected.message}</p>
              </div>
              <div className="space-y-3">
                {threadReplies.map((r) => {
                  const isUser = r.sender_type === "user";
                  return (
                    <div
                      key={r.id}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                          isUser ? "bg-primary/20 text-foreground" : "bg-card border border-border"
                        }`}
                      >
                        {!isUser ? (
                          <p className="text-[10px] font-semibold text-muted-foreground mb-1">Vibely Support</p>
                        ) : null}
                        <p className="whitespace-pre-wrap">{r.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {selected.status !== "resolved" ? (
              <div className="p-4 border-t border-border space-y-3">
                <Textarea
                  placeholder="Write a reply…"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={3}
                />
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="send-email"
                    checked={sendEmail}
                    onCheckedChange={(c) => setSendEmail(c === true)}
                  />
                  <label htmlFor="send-email" className="text-sm text-muted-foreground">
                    Send email copy to user
                  </label>
                </div>
                <Button
                  onClick={() => sendReplyMutation.mutate()}
                  disabled={!replyText.trim() || sendReplyMutation.isPending}
                  className="gap-2"
                >
                  {sendReplyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </Button>
              </div>
            ) : null}

            <div className="p-4 border-t border-border space-y-2">
              <p className="text-xs font-semibold text-amber-600/90 uppercase tracking-wide">
                Internal notes (not visible to user)
              </p>
              <Textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={2}
                placeholder="Notes for admins only…"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => saveNotesMutation.mutate({ id: selected.id, notes: notesDraft })}
                disabled={saveNotesMutation.isPending}
              >
                Save notes
              </Button>
            </div>
          </>
        )}
      </div>

      {profileUserId ? (
        <AdminUserDetailDrawer userId={profileUserId} onClose={() => setProfileUserId(null)} />
      ) : null}
    </div>
  );
}
