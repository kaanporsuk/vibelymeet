import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Upload,
  Download,
  FileJson,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";

interface BatchEventImportModalProps {
  onClose: () => void;
}

interface ParsedEvent {
  title: string;
  description?: string;
  event_date: string;
  duration_minutes: number;
  max_attendees: number;
  max_male_attendees?: number;
  max_female_attendees?: number;
  max_nonbinary_attendees?: number;
  is_free?: boolean;
  price_amount?: number;
  cover_image?: string;
  location_name?: string;
  is_location_specific?: boolean;
  status?: string;
  visibility?: string;
  tags?: string[];
  vibe_tags?: string[];
}

interface ValidatedEvent extends ParsedEvent {
  _index: number;
  _valid: boolean;
  _errors: string[];
  _selected: boolean;
}

const VALID_STATUSES = ["draft", "scheduled", "upcoming", "live"];

const TEMPLATE_EVENTS: ParsedEvent[] = [
  {
    title: "Friday Night Vibes",
    description: "Speed dating for young professionals",
    event_date: "2026-02-21T20:00:00",
    duration_minutes: 60,
    max_attendees: 50,
    max_male_attendees: 25,
    max_female_attendees: 25,
    is_free: true,
    price_amount: 0,
    cover_image: "",
    location_name: "Digital Lobby",
    is_location_specific: false,
    status: "scheduled",
    visibility: "all",
    tags: ["Speed Dating", "Young Professionals"],
    vibe_tags: ["Adventurous", "Ambitious"],
  },
  {
    title: "Sunday Brunch & Mingle",
    description: "Relaxed weekend dating over brunch vibes",
    event_date: "2026-02-22T11:00:00",
    duration_minutes: 90,
    max_attendees: 30,
    max_male_attendees: 15,
    max_female_attendees: 15,
    is_free: false,
    price_amount: 5,
    cover_image: "",
    location_name: "Virtual Cafe",
    is_location_specific: false,
    status: "scheduled",
    visibility: "all",
    tags: ["Brunch", "Casual"],
    vibe_tags: ["Foodie", "Creative"],
  },
];

function validateEvent(ev: any, index: number): ValidatedEvent {
  const errors: string[] = [];
  const title = ev.title?.toString().trim() || "";
  if (!title) errors.push("Title is required");

  const eventDate = ev.event_date?.toString().trim() || "";
  const parsedDate = new Date(eventDate);
  if (!eventDate || isNaN(parsedDate.getTime())) {
    errors.push("Invalid date format");
  } else if (parsedDate < new Date()) {
    errors.push("Date must be in the future");
  }

  const duration = parseInt(ev.duration_minutes) || 0;
  if (duration < 15 || duration > 480) errors.push("Duration must be 15–480 min");

  const maxAttendees = parseInt(ev.max_attendees) || 0;
  if (maxAttendees <= 0) errors.push("Attendees must be > 0");

  const status = ev.status?.toString().trim().toLowerCase() || "scheduled";
  if (!VALID_STATUSES.includes(status)) errors.push(`Status must be: ${VALID_STATUSES.join(", ")}`);

  // Parse arrays that may come as strings
  let tags = ev.tags;
  if (typeof tags === "string") {
    try { tags = JSON.parse(tags); } catch { tags = tags.split(",").map((t: string) => t.trim()).filter(Boolean); }
  }
  let vibes = ev.vibe_tags;
  if (typeof vibes === "string") {
    try { vibes = JSON.parse(vibes); } catch { vibes = vibes.split(",").map((t: string) => t.trim()).filter(Boolean); }
  }

  return {
    title,
    description: ev.description?.toString() || "",
    event_date: eventDate,
    duration_minutes: duration || 60,
    max_attendees: maxAttendees || 50,
    max_male_attendees: parseInt(ev.max_male_attendees) || undefined,
    max_female_attendees: parseInt(ev.max_female_attendees) || undefined,
    max_nonbinary_attendees: parseInt(ev.max_nonbinary_attendees) || undefined,
    is_free: ev.is_free === true || ev.is_free === "true" || ev.is_free === undefined,
    price_amount: parseFloat(ev.price_amount) || 0,
    cover_image: ev.cover_image?.toString() || "",
    location_name: ev.location_name?.toString() || "",
    is_location_specific: ev.is_location_specific === true || ev.is_location_specific === "true",
    status,
    visibility: ev.visibility?.toString() || "all",
    tags: Array.isArray(tags) ? tags : [],
    vibe_tags: Array.isArray(vibes) ? vibes : [],
    _index: index,
    _valid: errors.length === 0,
    _errors: errors,
    _selected: errors.length === 0,
  };
}

const BatchEventImportModal = ({ onClose }: BatchEventImportModalProps) => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState("json");
  const [events, setEvents] = useState<ValidatedEvent[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const validCount = events.filter((e) => e._valid).length;
  const selectedCount = events.filter((e) => e._selected).length;

  const handleFile = useCallback((file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "json") {
      setActiveTab("json");
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          setEvents(arr.map((ev, i) => validateEvent(ev, i)));
        } catch {
          toast.error("Invalid JSON file");
        }
      };
      reader.readAsText(file);
    } else if (ext === "csv") {
      setActiveTab("csv");
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setEvents((results.data as any[]).map((ev, i) => validateEvent(ev, i)));
        },
        error: () => toast.error("Failed to parse CSV"),
      });
    } else {
      toast.error("Unsupported file type. Use .json or .csv");
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const toggleAll = (checked: boolean) => {
    setEvents((prev) => prev.map((ev) => ({ ...ev, _selected: ev._valid ? checked : false })));
  };

  const toggleOne = (index: number) => {
    setEvents((prev) =>
      prev.map((ev) => (ev._index === index ? { ...ev, _selected: ev._valid && !ev._selected } : ev))
    );
  };

  const downloadTemplate = (format: "json" | "csv") => {
    if (format === "json") {
      const blob = new Blob([JSON.stringify(TEMPLATE_EVENTS, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "events_template.json";
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const csv = Papa.unparse(
        TEMPLATE_EVENTS.map((e) => ({
          ...e,
          tags: JSON.stringify(e.tags),
          vibe_tags: JSON.stringify(e.vibe_tags),
        }))
      );
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "events_template.csv";
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleImport = async () => {
    const toImport = events.filter((e) => e._selected && e._valid);
    if (toImport.length === 0) {
      toast.error("No valid events selected");
      return;
    }

    setIsImporting(true);
    try {
      const rows = toImport.map((ev) => ({
        title: ev.title,
        description: ev.description || null,
        event_date: new Date(ev.event_date).toISOString(),
        duration_minutes: ev.duration_minutes,
        max_attendees: ev.max_attendees,
        max_male_attendees: ev.max_male_attendees || null,
        max_female_attendees: ev.max_female_attendees || null,
        max_nonbinary_attendees: ev.max_nonbinary_attendees || null,
        is_free: ev.is_free ?? true,
        price_amount: ev.price_amount || 0,
        cover_image: ev.cover_image || "",
        location_name: ev.location_name || null,
        is_location_specific: ev.is_location_specific || false,
        status: ev.status || "scheduled",
        visibility: ev.visibility || "all",
        tags: ev.tags || [],
        vibes: ev.vibe_tags || [],
      }));

      const { error } = await supabase.from("events").insert(rows);
      if (error) throw error;

      const skipped = events.length - toImport.length;
      toast.success(
        `${toImport.length} of ${events.length} events imported successfully.${skipped > 0 ? ` ${skipped} skipped.` : ""}`
      );
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      onClose();
    } catch (err: any) {
      toast.error("Import failed", { description: err.message });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background z-50 flex flex-col"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold font-display text-foreground">Batch Import Events</h2>
            <p className="text-sm text-muted-foreground">Upload a JSON or CSV file to create multiple events at once</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-4 space-y-6 pb-32">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 max-w-xs">
              <TabsTrigger value="json" className="gap-1.5">
                <FileJson className="w-4 h-4" /> JSON
              </TabsTrigger>
              <TabsTrigger value="csv" className="gap-1.5">
                <FileSpreadsheet className="w-4 h-4" /> CSV
              </TabsTrigger>
            </TabsList>

            <TabsContent value="json" className="mt-4">
              <Button variant="link" className="gap-1.5 px-0 text-primary" onClick={() => downloadTemplate("json")}>
                <Download className="w-4 h-4" /> Download JSON Template
              </Button>
            </TabsContent>
            <TabsContent value="csv" className="mt-4">
              <Button variant="link" className="gap-1.5 px-0 text-primary" onClick={() => downloadTemplate("csv")}>
                <Download className="w-4 h-4" /> Download CSV Template
              </Button>
            </TabsContent>
          </Tabs>

          {/* Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-foreground font-medium mb-1">
              Drag & drop your file here
            </p>
            <p className="text-sm text-muted-foreground mb-3">or</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv"
              onChange={handleFileInput}
              className="hidden"
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              Choose File
            </Button>
          </div>

          {/* Preview Table */}
          {events.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {events.length} events found, <span className="text-foreground font-medium">{validCount} valid</span>
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => toggleAll(true)}>Select All</Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleAll(false)}>Deselect All</Button>
                </div>
              </div>

              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50">
                        <TableHead className="w-10" />
                        <TableHead>Title</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Capacity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Valid</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.map((ev) => (
                        <TableRow
                          key={ev._index}
                          className={`border-border/50 ${!ev._valid ? "bg-destructive/5" : ""}`}
                        >
                          <TableCell>
                            <Checkbox
                              checked={ev._selected}
                              disabled={!ev._valid}
                              onCheckedChange={() => toggleOne(ev._index)}
                            />
                          </TableCell>
                          <TableCell className="font-medium text-foreground">{ev.title || "—"}</TableCell>
                          <TableCell className="text-sm">
                            {ev.event_date ? new Date(ev.event_date).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell>{ev.duration_minutes} min</TableCell>
                          <TableCell>{ev.max_attendees}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-xs">{ev.status}</Badge>
                          </TableCell>
                          <TableCell>
                            {ev._valid ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <AlertCircle className="w-4 h-4 text-destructive" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <ul className="text-xs space-y-0.5">
                                      {ev._errors.map((err, i) => (
                                        <li key={i}>• {err}</li>
                                      ))}
                                    </ul>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {events.length > 0 && (
        <div className="shrink-0 border-t border-border bg-card">
          <div className="max-w-5xl mx-auto px-4 py-4 flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleImport}
              disabled={isImporting || selectedCount === 0}
              className="bg-gradient-to-r from-primary to-accent gap-2"
            >
              {isImporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Import Selected ({selectedCount})
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default BatchEventImportModal;
