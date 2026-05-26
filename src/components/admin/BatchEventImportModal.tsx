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
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { callAdminRpc, createAdminIdempotencyKey, createAdminTargetIdempotencyKey } from "@/lib/adminRpc";
import { inferEventCategoryKeysFromLegacyTags } from "@clientShared/eventCategories";

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
  scope?: "global" | "regional" | "local";
  latitude?: number;
  longitude?: number;
  radius_km?: number;
  city?: string;
  country?: string;
  status?: string;
  visibility?: string;
  tags?: string[];
  category_keys?: string[];
  vibe_tags?: string[];
}

interface ValidatedEvent extends ParsedEvent {
  _index: number;
  _valid: boolean;
  _errors: string[];
  _selected: boolean;
}

const VALID_STATUSES = ["draft", "upcoming"];
const VALID_VISIBILITIES = ["all", "premium", "vip"];
const VALID_SCOPES = ["global", "regional", "local"];

type RawImportEvent = Record<string, unknown>;

function stringValue(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function numberValue(value: unknown): number {
  const parsed = Number.parseFloat(stringValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumberValue(value: unknown): number | undefined {
  const raw = stringValue(value).trim();
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function optionalIntegerValue(value: unknown): number | undefined {
  const raw = stringValue(value).trim();
  if (!raw) return undefined;
  if (!/^-?\d+$/.test(raw)) return Number.NaN;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  const raw = stringValue(value).trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function hasInvalidBooleanValue(value: unknown): boolean {
  if (typeof value === "boolean" || value == null) return false;
  const raw = stringValue(value).trim().toLowerCase();
  return raw !== "" && raw !== "true" && raw !== "false";
}

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item).trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return stringArrayValue(parsed);
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

const TEMPLATE_EVENTS: ParsedEvent[] = [
  {
    title: "Friday Night Vibes",
    description: "Speed dating for young professionals",
    event_date: "2027-06-21T20:00:00",
    duration_minutes: 60,
    max_attendees: 50,
    max_male_attendees: 25,
    max_female_attendees: 25,
    is_free: true,
    price_amount: 0,
    cover_image: "",
    location_name: "Digital Lobby",
    is_location_specific: false,
    scope: "global",
    latitude: undefined,
    longitude: undefined,
    radius_km: undefined,
    city: "",
    country: "",
    status: "upcoming",
    visibility: "all",
    tags: ["Speed Dating", "Young Professionals"],
    vibe_tags: ["Adventurous", "Ambitious"],
  },
  {
    title: "Sunday Brunch & Mingle",
    description: "Relaxed weekend dating over brunch vibes",
    event_date: "2027-06-22T11:00:00",
    duration_minutes: 90,
    max_attendees: 30,
    max_male_attendees: 15,
    max_female_attendees: 15,
    is_free: false,
    price_amount: 5,
    cover_image: "",
    location_name: "Virtual Cafe",
    is_location_specific: false,
    scope: "global",
    latitude: undefined,
    longitude: undefined,
    radius_km: undefined,
    city: "",
    country: "",
    status: "upcoming",
    visibility: "all",
    tags: ["Brunch", "Casual"],
    vibe_tags: ["Foodie", "Creative"],
  },
];

function validateEvent(ev: RawImportEvent, index: number): ValidatedEvent {
  const errors: string[] = [];
  const title = stringValue(ev.title).trim();
  if (!title) errors.push("Title is required");

  const eventDate = stringValue(ev.event_date).trim();
  const parsedDate = new Date(eventDate);
  if (!eventDate || isNaN(parsedDate.getTime())) {
    errors.push("Invalid date format");
  } else if (parsedDate < new Date()) {
    errors.push("Date must be in the future");
  }

  const duration = Math.trunc(numberValue(ev.duration_minutes));
  if (duration < 15 || duration > 480) errors.push("Duration must be 15–480 min");

  const maxAttendees = Math.trunc(numberValue(ev.max_attendees));
  if (maxAttendees <= 0) errors.push("Attendees must be > 0");
  else if (maxAttendees > 10000) errors.push("Attendees must be 10000 or fewer");

  const genderCaps = {
    max_male_attendees: optionalIntegerValue(ev.max_male_attendees),
    max_female_attendees: optionalIntegerValue(ev.max_female_attendees),
    max_nonbinary_attendees: optionalIntegerValue(ev.max_nonbinary_attendees),
  };
  for (const [field, value] of Object.entries(genderCaps)) {
    if (Number.isNaN(value)) errors.push(`${field} must be an integer`);
    else if (value !== undefined && (value < 0 || value > 10000)) {
      errors.push(`${field} must be 0 to 10000`);
    }
  }

  const status = stringValue(ev.status).trim().toLowerCase() || "upcoming";
  if (!VALID_STATUSES.includes(status)) errors.push(`Status must be: ${VALID_STATUSES.join(", ")}`);

  const visibility = stringValue(ev.visibility).trim().toLowerCase() || "all";
  if (!VALID_VISIBILITIES.includes(visibility)) errors.push(`Visibility must be: ${VALID_VISIBILITIES.join(", ")}`);

  const isFree = booleanValue(ev.is_free, true);
  if (hasInvalidBooleanValue(ev.is_free)) errors.push("is_free must be true or false");
  const priceAmount = optionalNumberValue(ev.price_amount) ?? 0;
  if (Number.isNaN(priceAmount)) errors.push("Price must be numeric");
  else if (priceAmount < 0) errors.push("Price must be non-negative");
  else if (!isFree && priceAmount <= 0) errors.push("Paid events require price > 0");

  const isLocationSpecific = booleanValue(ev.is_location_specific, false);
  if (hasInvalidBooleanValue(ev.is_location_specific)) errors.push("is_location_specific must be true or false");
  const scope = stringValue(ev.scope).trim().toLowerCase() || "global";
  if (!VALID_SCOPES.includes(scope)) errors.push(`Scope must be: ${VALID_SCOPES.join(", ")}`);

  const latitude = optionalNumberValue(ev.latitude);
  const longitude = optionalNumberValue(ev.longitude);
  const radiusKm = optionalNumberValue(ev.radius_km);
  if (Number.isNaN(latitude)) errors.push("Latitude must be numeric");
  if (Number.isNaN(longitude)) errors.push("Longitude must be numeric");
  if (Number.isNaN(radiusKm)) errors.push("Radius must be numeric");
  if (latitude !== undefined && !Number.isNaN(latitude) && (latitude < -90 || latitude > 90)) {
    errors.push("Latitude must be -90 to 90");
  }
  if (longitude !== undefined && !Number.isNaN(longitude) && (longitude < -180 || longitude > 180)) {
    errors.push("Longitude must be -180 to 180");
  }
  if (radiusKm !== undefined && !Number.isNaN(radiusKm) && (radiusKm < 5 || radiusKm > 500)) {
    errors.push("Radius must be 5–500 km");
  }

  const city = stringValue(ev.city).trim();
  const country = stringValue(ev.country).trim();
  if (scope === "regional" && !country) errors.push("Regional events require country");
  if (scope === "local") {
    if (latitude === undefined || longitude === undefined || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      errors.push("Local events require coordinates");
    }
    if (radiusKm === undefined || Number.isNaN(radiusKm)) errors.push("Local events require radius");
    if (!city) errors.push("Local events require city");
  }
  if (isLocationSpecific && (latitude === undefined || longitude === undefined || Number.isNaN(latitude) || Number.isNaN(longitude))) {
    errors.push("Location-specific rows require coordinates");
  }

  const tags = stringArrayValue(ev.tags);
  const explicitCategoryKeys = stringArrayValue(ev.category_keys);
  const vibes = stringArrayValue(ev.vibe_tags);

  return {
    title,
    description: stringValue(ev.description),
    event_date: eventDate,
    duration_minutes: duration || 60,
    max_attendees: maxAttendees || 50,
    max_male_attendees: Number.isNaN(genderCaps.max_male_attendees) ? undefined : genderCaps.max_male_attendees,
    max_female_attendees: Number.isNaN(genderCaps.max_female_attendees) ? undefined : genderCaps.max_female_attendees,
    max_nonbinary_attendees: Number.isNaN(genderCaps.max_nonbinary_attendees) ? undefined : genderCaps.max_nonbinary_attendees,
    is_free: isFree,
    price_amount: Number.isNaN(priceAmount) ? undefined : priceAmount,
    cover_image: stringValue(ev.cover_image),
    location_name: stringValue(ev.location_name),
    is_location_specific: isLocationSpecific,
    scope: scope as ParsedEvent["scope"],
    latitude: Number.isNaN(latitude) ? undefined : latitude,
    longitude: Number.isNaN(longitude) ? undefined : longitude,
    radius_km: Number.isNaN(radiusKm) ? undefined : radiusKm,
    city,
    country,
    status,
    visibility,
    tags,
    category_keys: explicitCategoryKeys.length > 0
      ? explicitCategoryKeys
      : inferEventCategoryKeysFromLegacyTags(tags),
    vibe_tags: vibes,
    _index: index,
    _valid: errors.length === 0,
    _errors: errors,
    _selected: errors.length === 0,
  };
}

const BatchEventImportModal = ({ onClose }: BatchEventImportModalProps) => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importBatchIntentIdRef = useRef(createAdminIdempotencyKey("admin_batch_event_import"));
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
          const arr = (Array.isArray(parsed) ? parsed : [parsed]) as RawImportEvent[];
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
          setEvents((results.data as RawImportEvent[]).map((ev, i) => validateEvent(ev, i)));
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
          category_keys: JSON.stringify(e.category_keys),
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
        scope: ev.scope || "global",
        latitude: ev.latitude ?? null,
        longitude: ev.longitude ?? null,
        radius_km: ev.radius_km ?? null,
        city: ev.city || null,
        country: ev.country || null,
        status: ev.status || "upcoming",
        visibility: ev.visibility || "all",
        tags: ev.tags || [],
        category_keys: ev.category_keys || inferEventCategoryKeysFromLegacyTags(ev.tags || []),
        vibes: ev.vibe_tags || [],
      }));

      const successfulIndexes: number[] = [];
      const failedRows: Array<{ rowNumber: number; title: string; message: string }> = [];

      for (const [index, row] of rows.entries()) {
        try {
          await callAdminRpc("admin_create_event", {
            p_payload: row,
            p_idempotency_key: createAdminTargetIdempotencyKey("admin_create_event", {
              batch_intent_id: importBatchIntentIdRef.current,
              source_row_index: toImport[index]._index,
            }, row),
          });
          successfulIndexes.push(toImport[index]._index);
        } catch (err: unknown) {
          failedRows.push({
            rowNumber: toImport[index]._index + 1,
            title: row.title,
            message: err instanceof Error ? err.message : "Unknown import failure",
          });
        }
      }

      if (successfulIndexes.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      }

      if (failedRows.length > 0) {
        const successfulSet = new Set(successfulIndexes);
        setEvents((current) =>
          current.map((event) =>
            successfulSet.has(event._index)
              ? { ...event, _selected: false }
              : event
          )
        );
        const failedSummary = failedRows
          .slice(0, 3)
          .map((row) => `row ${row.rowNumber} (${row.title}): ${row.message}`)
          .join("; ");
        toast.error(
          `${successfulIndexes.length} of ${toImport.length} selected events were imported. ${failedRows.length} failed.`,
          {
            description: `${failedSummary}${failedRows.length > 3 ? "; more rows failed" : ""}. Confirmed successful rows were deselected to prevent duplicate retries.`,
          }
        );
        return;
      }

      const skipped = events.length - toImport.length;
      toast.success(
        `${toImport.length} of ${events.length} events imported successfully.${skipped > 0 ? ` ${skipped} skipped.` : ""}`
      );
      importBatchIntentIdRef.current = createAdminIdempotencyKey("admin_batch_event_import");
      onClose();
    } catch (err: unknown) {
      toast.error("Import failed", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
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
