import { useMemo, useState } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

interface CountryCodeSelectorProps {
  value: string; // e.g. "+31"
  onChange: (code: string) => void;
}

type Country = {
  name: string;
  code: string; // dial code, e.g. "+31"
  flag: string;
  priority?: boolean;
};

const COUNTRIES: Country[] = [
  // Priority (EU + key markets) — Poland first as product default for web auth
  { name: "Poland", code: "+48", flag: "🇵🇱", priority: true },
  { name: "Netherlands", code: "+31", flag: "🇳🇱", priority: true },
  { name: "Germany", code: "+49", flag: "🇩🇪", priority: true },
  { name: "France", code: "+33", flag: "🇫🇷", priority: true },
  { name: "United Kingdom", code: "+44", flag: "🇬🇧", priority: true },
  { name: "Spain", code: "+34", flag: "🇪🇸", priority: true },
  { name: "Italy", code: "+39", flag: "🇮🇹", priority: true },
  { name: "Türkiye", code: "+90", flag: "🇹🇷", priority: true },
  { name: "Sweden", code: "+46", flag: "🇸🇪", priority: true },
  { name: "Portugal", code: "+351", flag: "🇵🇹", priority: true },
  // Common global
  { name: "United States", code: "+1", flag: "🇺🇸" },
  { name: "Canada", code: "+1", flag: "🇨🇦" },
  { name: "Ireland", code: "+353", flag: "🇮🇪" },
  { name: "Norway", code: "+47", flag: "🇳🇴" },
  { name: "Denmark", code: "+45", flag: "🇩🇰" },
  { name: "Belgium", code: "+32", flag: "🇧🇪" },
  { name: "Austria", code: "+43", flag: "🇦🇹" },
  { name: "Switzerland", code: "+41", flag: "🇨🇭" },
  { name: "Finland", code: "+358", flag: "🇫🇮" },
  { name: "Czechia", code: "+420", flag: "🇨🇿" },
  { name: "Greece", code: "+30", flag: "🇬🇷" },
  { name: "Hungary", code: "+36", flag: "🇭🇺" },
  { name: "Romania", code: "+40", flag: "🇷🇴" },
  { name: "Bulgaria", code: "+359", flag: "🇧🇬" },
  { name: "Croatia", code: "+385", flag: "🇭🇷" },
  { name: "Slovakia", code: "+421", flag: "🇸🇰" },
  { name: "Slovenia", code: "+386", flag: "🇸🇮" },
  { name: "Australia", code: "+61", flag: "🇦🇺" },
  { name: "New Zealand", code: "+64", flag: "🇳🇿" },
  { name: "Brazil", code: "+55", flag: "🇧🇷" },
  { name: "Mexico", code: "+52", flag: "🇲🇽" },
  { name: "Argentina", code: "+54", flag: "🇦🇷" },
  { name: "Chile", code: "+56", flag: "🇨🇱" },
  { name: "India", code: "+91", flag: "🇮🇳" },
  { name: "Pakistan", code: "+92", flag: "🇵🇰" },
  { name: "Bangladesh", code: "+880", flag: "🇧🇩" },
  { name: "South Africa", code: "+27", flag: "🇿🇦" },
];

function detectDefaultCode(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || "";
    const lower = locale.toLowerCase();
    if (lower.includes("nl")) return "+31";
    if (lower.includes("de")) return "+49";
    if (lower.includes("fr")) return "+33";
    if (lower.includes("es")) return "+34";
    if (lower.includes("it")) return "+39";
    if (lower.includes("pl")) return "+48";
    if (lower.includes("tr")) return "+90";
    if (lower.includes("sv") || lower.includes("se")) return "+46";
    if (lower.includes("pt")) return "+351";
    if (lower.includes("en-us") || lower.includes("us")) return "+1";
  } catch {
    // ignore
  }
  return "+48";
}

export const CountryCodeSelector = ({ value, onChange }: CountryCodeSelectorProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => COUNTRIES.find((c) => c.code === value) ?? COUNTRIES.find((c) => c.code === detectDefaultCode()) ?? COUNTRIES[0],
    [value]
  );

  const [priority, rest] = useMemo(() => {
    const p = COUNTRIES.filter((c) => c.priority);
    const r = COUNTRIES.filter((c) => !c.priority);
    return [p, r];
  }, []);

  const filteredPriority = useMemo(
    () =>
      priority.filter((c) => {
        const q = query.toLowerCase();
        return (
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.code.includes(q.replace(/\D/g, "")) ||
          c.flag.includes(q)
        );
      }),
    [priority, query]
  );

  const filteredRest = useMemo(
    () =>
      rest.filter((c) => {
        const q = query.toLowerCase();
        return (
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.code.includes(q.replace(/\D/g, "")) ||
          c.flag.includes(q)
        );
      }),
    [rest, query]
  );

  const handleSelect = (code: string) => {
    onChange(code);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-12 px-3 gap-2 bg-secondary/60 border-border text-sm font-medium"
        >
          <span className="text-lg">{selected?.flag}</span>
          <span>{selected?.code}</span>
          <ChevronsUpDown className="w-4 h-4 ml-1 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2 bg-popover border-border">
        <div className="flex items-center gap-2 mb-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search country or code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="max-h-72 overflow-y-auto space-y-2">
          {filteredPriority.length > 0 && (
            <div>
              <p className="px-1 mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Popular
              </p>
              {filteredPriority.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => handleSelect(c.code)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm hover:bg-secondary/60"
                >
                  <span className="flex items-center gap-2">
                    <span>{c.flag}</span>
                    <span>{c.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{c.code}</span>
                </button>
              ))}
            </div>
          )}
          {filteredRest.length > 0 && (
            <div>
              {filteredPriority.length > 0 && (
                <p className="px-1 mt-2 mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  All countries
                </p>
              )}
              {filteredRest.map((c) => (
                <button
                  key={`${c.code}-${c.name}`}
                  type="button"
                  onClick={() => handleSelect(c.code)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm hover:bg-secondary/60"
                >
                  <span className="flex items-center gap-2">
                    <span>{c.flag}</span>
                    <span>{c.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{c.code}</span>
                </button>
              ))}
            </div>
          )}
          {filteredPriority.length === 0 && filteredRest.length === 0 && (
            <p className="px-1 py-4 text-xs text-muted-foreground text-center">
              No countries match your search.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const getDefaultCountryCode = () => detectDefaultCode();

