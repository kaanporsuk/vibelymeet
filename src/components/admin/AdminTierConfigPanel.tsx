import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Loader2, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CAPABILITY_REGISTRY,
  TIER_IDS,
  getAllTiersWithOverrides,
  getTierDefinition,
  type CapabilityMeta,
  type TierConfigOverride,
  type TierId,
} from "@shared/tiers";

const SECTIONS: { title: string; category: CapabilityMeta["category"] }[] = [
  { title: "Feature gates", category: "boolean" },
  { title: "Usage limits", category: "quota" },
  { title: "Content access", category: "access" },
];

const EVENT_TIER_OPTIONS = ["free", "premium", "vip"] as const;

function CapabilityCell({
  meta,
  isCustom,
  rawValue,
  onSet,
  onReset,
  isPending,
}: {
  meta: CapabilityMeta;
  isCustom: boolean;
  rawValue: unknown;
  onSet: (value: unknown) => void;
  onReset: () => void;
  isPending: boolean;
}) {
  const [numDraft, setNumDraft] = useState("");

  useEffect(() => {
    if (meta.type === "boolean" || meta.type === "string_array") return;
    if (meta.type === "number_or_null" && (rawValue === null || rawValue === undefined)) {
      setNumDraft("");
      return;
    }
    if (meta.type === "number" || meta.type === "number_or_null") {
      setNumDraft(rawValue === null || rawValue === undefined ? "" : String(rawValue));
    }
  }, [rawValue, meta.type, meta.key]);

  if (meta.type === "boolean") {
    return (
      <div className="flex flex-col items-center gap-2 py-2">
        <div className="flex items-center gap-2">
          <Switch
            checked={rawValue === true}
            disabled={isPending}
            onCheckedChange={(c) => onSet(c)}
          />
          {isCustom && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-primary"
              disabled={isPending}
              onClick={() => onReset()}
              title="Reset to default"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Badge variant={isCustom ? "default" : "secondary"} className={isCustom ? "bg-primary/20 text-primary border-primary/30" : ""}>
          {isCustom ? "Custom" : "Default"}
        </Badge>
      </div>
    );
  }

  if (meta.type === "number") {
    return (
      <div className="flex flex-col items-center gap-2 py-2">
        <div className="flex items-center gap-1">
          <Input
            type="number"
            className="h-9 w-20 bg-secondary/50 text-center"
            value={numDraft}
            disabled={isPending}
            onChange={(e) => setNumDraft(e.target.value)}
            onBlur={() => {
              const n = Number(numDraft);
              if (Number.isNaN(n)) return;
              onSet(n);
            }}
          />
          {isCustom && (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={isPending} onClick={() => onReset()}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Badge variant={isCustom ? "default" : "secondary"} className={isCustom ? "bg-primary/20 text-primary border-primary/30" : ""}>
          {isCustom ? "Custom" : "Default"}
        </Badge>
      </div>
    );
  }

  if (meta.type === "number_or_null") {
    const unlimited = rawValue === null || rawValue === undefined;
    return (
      <div className="flex flex-col items-center gap-2 py-2">
        <div className="flex flex-col items-center gap-2 w-full max-w-[140px]">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={unlimited}
              disabled={isPending}
              onCheckedChange={(c) => {
                if (c) {
                  setNumDraft("");
                  onSet(null);
                } else {
                  onSet(0);
                  setNumDraft("0");
                }
              }}
            />
            Unlimited (∞)
          </label>
          {!unlimited && (
            <Input
              type="number"
              className="h-9 w-full bg-secondary/50 text-center"
              value={numDraft}
              disabled={isPending}
              onChange={(e) => setNumDraft(e.target.value)}
              onBlur={() => {
                const n = Number(numDraft);
                if (Number.isNaN(n)) return;
                onSet(n);
              }}
            />
          )}
        </div>
        {isCustom && (
          <Button type="button" variant="ghost" size="sm" className="text-xs h-8" disabled={isPending} onClick={() => onReset()}>
            Reset default
          </Button>
        )}
        <Badge variant={isCustom ? "default" : "secondary"} className={isCustom ? "bg-primary/20 text-primary border-primary/30" : ""}>
          {isCustom ? "Custom" : "Default"}
        </Badge>
      </div>
    );
  }

  // string_array — event tier access
  const selected = new Set(Array.isArray(rawValue) ? rawValue.filter((x): x is string => typeof x === "string") : []);
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <div className="flex flex-wrap justify-center gap-1">
        {EVENT_TIER_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={isPending}
            onClick={() => {
              const next = new Set(selected);
              if (next.has(opt)) next.delete(opt);
              else next.add(opt);
              onSet([...next]);
            }}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
              selected.has(opt)
                ? "bg-primary/25 text-primary border-primary/40"
                : "bg-secondary/40 text-muted-foreground border-border"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      {isCustom && (
        <Button type="button" variant="ghost" size="sm" className="text-xs h-7" disabled={isPending} onClick={() => onReset()}>
          Reset
        </Button>
      )}
      <Badge variant={isCustom ? "default" : "secondary"} className={isCustom ? "bg-primary/20 text-primary border-primary/30" : ""}>
        {isCustom ? "Custom" : "Default"}
      </Badge>
    </div>
  );
}

const AdminTierConfigPanel = () => {
  const qc = useQueryClient();
  const [auditOpen, setAuditOpen] = useState(false);

  const { data: overrides = [], isLoading } = useQuery({
    queryKey: ["tier-config-overrides"],
    queryFn: async (): Promise<TierConfigOverride[]> => {
      const { data, error } = await supabase.from("tier_config_overrides").select("tier_id, capability_key, value");
      if (error) throw error;
      return (data ?? []) as TierConfigOverride[];
    },
  });

  const { data: auditRows = [] } = useQuery({
    queryKey: ["tier-config-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tier_config_audit")
        .select("id, tier_id, capability_key, old_value, new_value, action, admin_id, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("admin-tier-config-overrides")
      .on("postgres_changes", { event: "*", schema: "public", table: "tier_config_overrides" }, () => {
        void qc.invalidateQueries({ queryKey: ["tier-config-overrides"] });
        void qc.invalidateQueries({ queryKey: ["tier-config-audit"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const merged = useMemo(() => getAllTiersWithOverrides(overrides), [overrides]);

  const setMutation = useMutation({
    mutationFn: async ({ tierId, meta, value }: { tierId: TierId; meta: CapabilityMeta; value: unknown }) => {
      const { error } = await supabase.rpc("set_tier_config_override", {
        p_tier_id: tierId,
        p_capability_key: meta.key,
        p_value: value as Json,
      });
      if (error) throw error;
    },
    onMutate: async ({ tierId, meta, value }) => {
      await qc.cancelQueries({ queryKey: ["tier-config-overrides"] });
      const prev = qc.getQueryData<TierConfigOverride[]>(["tier-config-overrides"]) ?? [];
      const filtered = prev.filter((o) => !(o.tier_id === tierId && o.capability_key === meta.key));
      const next = [...filtered, { tier_id: tierId, capability_key: meta.key, value }];
      qc.setQueryData(["tier-config-overrides"], next);
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tier-config-overrides"], ctx.prev);
      toast.error(err instanceof Error ? err.message : "Could not save override");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tier-config-overrides"] });
      void qc.invalidateQueries({ queryKey: ["tier-config-audit"] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async ({ tierId, meta }: { tierId: TierId; meta: CapabilityMeta }) => {
      const { error } = await supabase.rpc("reset_tier_config_override", {
        p_tier_id: tierId,
        p_capability_key: meta.key,
      });
      if (error) throw error;
    },
    onMutate: async ({ tierId, meta }) => {
      await qc.cancelQueries({ queryKey: ["tier-config-overrides"] });
      const prev = qc.getQueryData<TierConfigOverride[]>(["tier-config-overrides"]) ?? [];
      const next = prev.filter((o) => !(o.tier_id === tierId && o.capability_key === meta.key));
      qc.setQueryData(["tier-config-overrides"], next);
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tier-config-overrides"], ctx.prev);
      toast.error(err instanceof Error ? err.message : "Could not reset override");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["tier-config-overrides"] });
      void qc.invalidateQueries({ queryKey: ["tier-config-audit"] });
    },
  });

  const pending = setMutation.isPending || resetMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Loading tier configuration…
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 max-w-6xl">
      <div>
        <h2 className="text-xl font-bold font-display text-foreground">Subscription tiers</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Code defaults live in <code className="text-xs bg-secondary/80 px-1 rounded">supabase/functions/_shared/tiers.ts</code>.
          Overrides here apply immediately for all clients (merged with profile <code className="text-xs">subscription_tier</code>).
        </p>
      </div>

      {SECTIONS.map((section) => {
        const rows = CAPABILITY_REGISTRY.filter((m) => m.category === section.category);
        if (rows.length === 0) return null;
        return (
          <div
            key={section.title}
            className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm p-6 shadow-[0_0_40px_hsl(var(--primary)/0.06)]"
          >
            <h3 className="text-lg font-semibold text-foreground mb-4">{section.title}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-3 pr-4 font-medium text-muted-foreground min-w-[200px]">Capability</th>
                    {TIER_IDS.map((id) => (
                      <th key={id} className="text-center py-3 px-2 font-display font-semibold text-foreground min-w-[140px]">
                        {getTierDefinition(id).label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((meta) => (
                    <tr key={meta.key} className="border-b border-border/30 align-top">
                      <td className="py-4 pr-4">
                        <p className="font-medium text-foreground">{meta.label}</p>
                        <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
                      </td>
                      {TIER_IDS.map((tierId) => {
                        const pack = merged[tierId];
                        const caps = pack.capabilities as unknown as Record<string, unknown>;
                        const raw = caps[meta.key];
                        const isCustom = pack.overriddenKeys.has(meta.key);
                        return (
                          <td key={tierId} className="py-2 px-2 text-center border-l border-border/20">
                            <CapabilityCell
                              meta={meta}
                              isCustom={isCustom}
                              rawValue={raw}
                              isPending={pending}
                              onSet={(value) => setMutation.mutate({ tierId, meta, value })}
                              onReset={() => resetMutation.mutate({ tierId, meta })}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <Collapsible open={auditOpen} onOpenChange={setAuditOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full py-2">
          <ChevronDown className={`h-4 w-4 transition-transform ${auditOpen ? "rotate-180" : ""}`} />
          Audit log (last 20)
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 rounded-xl border border-border/50 bg-secondary/20 p-4 space-y-2 max-h-64 overflow-y-auto">
          {auditRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No audit entries yet.</p>
          ) : (
            auditRows.map((row: { id: string; tier_id: string; capability_key: string; action: string; created_at: string }) => (
              <div key={row.id} className="text-xs flex flex-wrap gap-x-2 gap-y-1 border-b border-border/30 pb-2 last:border-0">
                <Badge variant="outline" className="text-[10px]">
                  {row.action}
                </Badge>
                <span className="text-foreground font-medium">{row.tier_id}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-primary">{row.capability_key}</span>
                <span className="text-muted-foreground ml-auto">{new Date(row.created_at).toLocaleString()}</span>
              </div>
            ))
          )}
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  );
};

export default AdminTierConfigPanel;
