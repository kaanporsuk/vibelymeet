import { useEffect, useState } from "react";
import { MessageSquareText, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { SUPPORT_CATEGORIES, PRIORITY_BY_TYPE, type PrimaryType } from "@/lib/supportCategories";
import { STATUS_CONFIG } from "@/lib/supportStatus";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FeedbackDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TicketListRow = {
  id: string;
  reference_id: string;
  subcategory: string;
  status: string;
  updated_at: string;
  message: string;
  primary_type: string;
};

const WEB_VERSION =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_APP_VERSION) || "1.0.0";

export const FeedbackDrawer = ({ open, onOpenChange }: FeedbackDrawerProps) => {
  const { user } = useUserProfile();
  const [view, setView] = useState<"home" | "compose" | "success">("home");
  const [primaryType, setPrimaryType] = useState<PrimaryType>("support");
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [smartValues, setSmartValues] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refId, setRefId] = useState<string | null>(null);
  const [ticketRows, setTicketRows] = useState<TicketListRow[]>([]);
  const [threadTicket, setThreadTicket] = useState<TicketListRow | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);

  const cfg = SUPPORT_CATEGORIES[primaryType];
  const smartFields = cfg.smartFields ?? [];

  const loadTickets = async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from("support_tickets")
      .select("id, reference_id, subcategory, status, updated_at, message, primary_type")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error(error);
      return;
    }
    setTicketRows((data ?? []) as TicketListRow[]);
  };

  useEffect(() => {
    if (open && user?.id) {
      void loadTickets();
    }
  }, [open, user?.id]);

  const isValid =
    subcategory !== null &&
    message.trim().length > 0 &&
    message.trim().length <= 2000;

  const resetCompose = () => {
    setSubcategory(null);
    setMessage("");
    setSmartValues({});
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setView("home");
      resetCompose();
      setRefId(null);
    }
    onOpenChange(o);
  };

  const handleSubmit = async () => {
    if (!isValid || !user) return;
    if (!navigator.onLine) {
      toast.error("You're offline — we'll need a connection to send this");
      return;
    }
    setIsSubmitting(true);

    const diagnostics = {
      platform: "web" as const,
      device_model: typeof navigator !== "undefined" ? navigator.userAgent.substring(0, 100) : "",
      os_version: typeof navigator !== "undefined" ? navigator.platform : "",
      app_version: WEB_VERSION,
    };

    const subjectLine = `${cfg.label} · ${subcategory}`;

    const { data: ticket, error } = await supabase
      .from("support_tickets")
      .insert({
        user_id: user.id,
        primary_type: primaryType,
        subcategory: subcategory!,
        subject: subjectLine,
        message: message.trim(),
        user_email: userEmail.trim() || user.email || null,
        priority: PRIORITY_BY_TYPE[primaryType],
        ...diagnostics,
      })
      .select("id, reference_id")
      .single();

    setIsSubmitting(false);

    if (error || !ticket) {
      toast.error("Failed to submit. Please try again.");
      return;
    }

    const filledSmart = Object.fromEntries(
      Object.entries(smartValues).filter(([, v]) => v && String(v).trim())
    );
    if (Object.keys(filledSmart).length > 0) {
      const body = Object.entries(filledSmart)
        .map(([k, v]) => {
          const label = k.replace(/_/g, " ");
          return `**${label}:** ${v}`;
        })
        .join("\n");
      await supabase.from("support_ticket_replies").insert({
        ticket_id: ticket.id,
        sender_type: "user",
        sender_id: user.id,
        message: body,
      });
    }

    trackEvent("support_ticket_submitted", { primary_type: primaryType });
    setRefId(ticket.reference_id);
    setView("success");
    void loadTickets();
  };

  const primaryTypes: PrimaryType[] = ["support", "feedback", "safety"];

  return (
    <>
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent className="max-h-[92vh]">
          <DrawerHeader>
            <DrawerTitle className="font-display flex items-center gap-2">
              <MessageSquareText className="w-5 h-5 text-primary" />
              Support & Feedback
            </DrawerTitle>
            <DrawerDescription>Get help, share ideas, or report concerns.</DrawerDescription>
          </DrawerHeader>

          {view === "home" && (
            <div className="px-4 pb-4 space-y-6 overflow-y-auto">
              <div className="space-y-3">
                {primaryTypes.map((pt) => {
                  const c = SUPPORT_CATEGORIES[pt];
                  return (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => {
                        setPrimaryType(pt);
                        resetCompose();
                        setUserEmail(user?.email ?? "");
                        setView("compose");
                      }}
                      className="w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-colors hover:bg-secondary/60"
                      style={{ borderColor: `${c.color}55` }}
                    >
                      <div
                        className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 text-lg font-bold"
                        style={{ backgroundColor: `${c.color}22`, color: c.color }}
                      >
                        {pt === "support" ? "?" : pt === "feedback" ? "💡" : "🛡"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground">{c.label}</p>
                        <p className="text-xs text-muted-foreground">{c.description}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                    </button>
                  );
                })}
              </div>

              <div>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground mb-2">
                  YOUR REQUESTS
                </p>
                {ticketRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    No requests yet. Your submitted requests will appear here.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {ticketRows.map((t) => {
                      const st =
                        STATUS_CONFIG[t.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.submitted;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setThreadTicket(t);
                            setThreadOpen(true);
                          }}
                          className="w-full flex items-start gap-2 p-3 rounded-lg border border-border/80 bg-secondary/20 text-left hover:bg-secondary/40"
                        >
                          <span
                            className="mt-1 w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: st.color }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-sm font-bold text-primary">{t.reference_id}</p>
                            <p className="text-sm text-foreground truncate">{t.subcategory}</p>
                            <p className="text-xs text-muted-foreground">
                              {st.label} · {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {view === "compose" && (
            <div className="px-4 pb-6 space-y-4 overflow-y-auto max-h-[70vh]">
              <Button variant="ghost" size="sm" onClick={() => setView("home")}>
                ← Back
              </Button>

              {primaryType === "safety" && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground">
                  Safety reports are reviewed by our team as a priority. If you are in immediate danger, contact
                  local emergency services.
                </div>
              )}

              <div className="border-l-4 pl-3" style={{ borderColor: cfg.color }}>
                <p className="font-bold text-lg">{cfg.label}</p>
                <p className="text-xs text-muted-foreground">{cfg.description}</p>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Subcategory</p>
                <div className="flex flex-wrap gap-2">
                  {cfg.subcategories.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSubcategory(s)}
                      className={`px-3 py-1.5 rounded-full text-xs border ${
                        subcategory === s ? "bg-primary/20 border-primary text-primary" : "bg-secondary/50 border-border"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {smartFields.map((sf) => (
                <div key={sf.key}>
                  <p className="text-sm font-medium mb-1">{sf.label}</p>
                  {sf.type === "select" && sf.options ? (
                    <div className="flex flex-wrap gap-2">
                      {sf.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setSmartValues((prev) => ({ ...prev, [sf.key]: opt }))}
                          className={`px-3 py-1 rounded-full text-xs border ${
                            smartValues[sf.key] === opt
                              ? "bg-primary/20 border-primary"
                              : "bg-secondary/40 border-border"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Input
                      placeholder={sf.placeholder}
                      value={smartValues[sf.key] ?? ""}
                      onChange={(e) => setSmartValues((prev) => ({ ...prev, [sf.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}

              <div>
                <p className="text-sm font-medium mb-1">Tell us more</p>
                <Textarea
                  placeholder="Describe in as much detail as possible..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                  rows={5}
                />
                <p className="text-xs text-muted-foreground text-right mt-1">{message.length} / 2000</p>
              </div>

              <div>
                <p className="text-sm font-medium mb-1">Reply to (email)</p>
                <Input
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder={user?.email ?? ""}
                />
                <p className="text-xs text-muted-foreground mt-1">We&apos;ll also send replies here</p>
              </div>

              <Button className="w-full" disabled={!isValid || isSubmitting} onClick={() => void handleSubmit()}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Submitting…
                  </>
                ) : (
                  "Submit request"
                )}
              </Button>
            </div>
          )}

          {view === "success" && refId && (
            <div className="px-4 pb-8 space-y-4 text-center">
              <div className="text-5xl text-primary">✓</div>
              <p className="text-xl font-bold">Request sent</p>
              <div className="rounded-xl border border-primary/30 bg-primary/10 py-4 px-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Reference</p>
                <p className="font-mono text-xl font-bold text-primary">{refId}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {primaryType === "feedback"
                  ? "We review all feedback. We'll reach out if we have questions."
                  : primaryType === "safety"
                    ? "Safety reports are reviewed urgently. Usually within a few hours."
                    : "We typically respond within 24 hours."}
              </p>
              {(userEmail || user?.email) && (
                <p className="text-xs text-muted-foreground">
                  We&apos;ll also send updates to {userEmail || user?.email}
                </p>
              )}
              <Button variant="outline" className="w-full" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <Dialog open={threadOpen} onOpenChange={setThreadOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono">{threadTicket?.reference_id}</DialogTitle>
          </DialogHeader>
          {threadTicket && <ThreadPanel ticket={threadTicket} />}
        </DialogContent>
      </Dialog>
    </>
  );
};

function ThreadPanel({ ticket }: { ticket: TicketListRow }) {
  const [rows, setRows] = useState<
    { id: string; sender_type: string; message: string; created_at: string }[]
  >([]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("support_ticket_replies")
        .select("id, sender_type, message, created_at")
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: true });
      if (data) setRows(data);
    })();
  }, [ticket.id]);

  return (
    <ScrollArea className="flex-1 pr-3 max-h-[60vh]">
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border bg-secondary/30 p-3">
          <p className="text-xs text-muted-foreground mb-1">{ticket.subcategory}</p>
          <p className="whitespace-pre-wrap">{ticket.message}</p>
        </div>
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className={`rounded-lg px-3 py-2 text-sm ${
                r.sender_type === "user" ? "bg-primary/15 ml-8" : "bg-card border mr-8"
              }`}
            >
              {r.sender_type === "admin" ? (
                <p className="text-[10px] font-semibold text-muted-foreground mb-1">Vibely Support</p>
              ) : null}
              <p className="whitespace-pre-wrap">{r.message}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
              </p>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
