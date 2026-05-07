import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  DollarSign,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { callAdminRpc, sanitizeAdminRpcErrorMessage, type AdminRpcPayload } from "@/lib/adminRpc";

type AdminMetricPayload = AdminRpcPayload & Record<string, unknown>;

type P4PayloadKey =
  | "product"
  | "retention"
  | "eventLiquidity"
  | "matchQuality"
  | "revenue"
  | "entitlements"
  | "trust"
  | "authenticity"
  | "cost"
  | "quality"
  | "store";

type P4RpcName =
  | "admin_get_product_intelligence_metrics"
  | "admin_get_retention_activation_metrics"
  | "admin_get_event_liquidity_metrics"
  | "admin_get_match_quality_metrics"
  | "admin_get_revenue_intelligence"
  | "admin_get_entitlement_reconciliation"
  | "admin_get_trust_triage_queue"
  | "admin_get_authenticity_operations"
  | "admin_get_cost_capacity_metrics"
  | "admin_get_quality_scorecard"
  | "admin_get_store_operations_metrics";

type P4Failure = {
  rpc: P4RpcName;
  message: string;
};

type P4MetricRequest = {
  key: P4PayloadKey;
  rpc: P4RpcName;
  promise: Promise<AdminMetricPayload>;
};

type P4Payload = Partial<Record<P4PayloadKey, AdminMetricPayload>> & {
  failures: P4Failure[];
};

type MetricCard = {
  label: string;
  value: unknown;
  helper?: string;
  icon?: LucideIcon;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const formatMetric = (value: unknown): string => {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString();
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "Unavailable";
};

const percent = (value: unknown): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return `${Math.round(value * 100)}%`;
};

const scoreBadge = (score: unknown) => {
  const numeric = typeof score === "number" ? score : 0;
  const className =
    numeric >= 75
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : numeric >= 45
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-red-500/15 text-red-300 border-red-500/30";
  return <Badge className={className}>{numeric}/100</Badge>;
};

const signalKey = (row: Record<string, unknown>, fallback: string): string => {
  const key = row.id || row.user_id || row.event_id || row.target_id || row.name || row.title;
  return typeof key === "string" && key.trim() ? key : fallback;
};

const p4MetricRequests = (): P4MetricRequest[] => [
  {
    key: "product",
    rpc: "admin_get_product_intelligence_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_product_intelligence_metrics", {}),
  },
  {
    key: "retention",
    rpc: "admin_get_retention_activation_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_retention_activation_metrics", {}),
  },
  {
    key: "eventLiquidity",
    rpc: "admin_get_event_liquidity_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_event_liquidity_metrics", {}),
  },
  {
    key: "matchQuality",
    rpc: "admin_get_match_quality_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_match_quality_metrics", {}),
  },
  {
    key: "revenue",
    rpc: "admin_get_revenue_intelligence",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_revenue_intelligence", {}),
  },
  {
    key: "entitlements",
    rpc: "admin_get_entitlement_reconciliation",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_entitlement_reconciliation", {
      p_limit: 25,
      p_offset: 0,
    }),
  },
  {
    key: "trust",
    rpc: "admin_get_trust_triage_queue",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_trust_triage_queue", {
      p_limit: 25,
      p_offset: 0,
    }),
  },
  {
    key: "authenticity",
    rpc: "admin_get_authenticity_operations",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_authenticity_operations", {}),
  },
  {
    key: "cost",
    rpc: "admin_get_cost_capacity_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_cost_capacity_metrics", {}),
  },
  {
    key: "quality",
    rpc: "admin_get_quality_scorecard",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_quality_scorecard", {}),
  },
  {
    key: "store",
    rpc: "admin_get_store_operations_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_store_operations_metrics", {}),
  },
];

const MetricGrid = ({ cards }: { cards: MetricCard[] }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
    {cards.map((card) => {
      const Icon = card.icon || BarChart3;
      return (
        <Card key={card.label} className="rounded-lg">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardDescription>{card.label}</CardDescription>
                <CardTitle className="text-2xl">{formatMetric(card.value)}</CardTitle>
              </div>
              <Icon className="h-5 w-5 text-primary" />
            </div>
          </CardHeader>
          {card.helper ? (
            <CardContent className="pt-0 text-xs text-muted-foreground">{card.helper}</CardContent>
          ) : null}
        </Card>
      );
    })}
  </div>
);

const SignalList = ({
  title,
  description,
  rows,
  empty,
}: {
  title: string;
  description: string;
  rows: Record<string, unknown>[];
  empty: string;
}) => (
  <Card className="rounded-lg">
    <CardHeader>
      <CardTitle className="text-lg">{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        rows.slice(0, 8).map((row, index) => (
          <div key={`${title}-${signalKey(row, String(index))}`} className="rounded-md border border-border/60 bg-secondary/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium text-foreground">
                {String(row.name || row.title || row.event_title || row.user_id || row.event_id || "Signal")}
              </div>
              {row.score !== undefined || row.risk_score !== undefined || row.liquidity_score !== undefined ? (
                scoreBadge(row.score ?? row.risk_score ?? row.liquidity_score)
              ) : null}
            </div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
              {Object.entries(row)
                .filter(([key]) => !["name", "title", "signals", "factors"].includes(key))
                .slice(0, 6)
                .map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3">
                    <span>{key.replace(/_/g, " ")}</span>
                    <span className="text-right text-foreground">
                      {typeof value === "object" && value !== null ? JSON.stringify(value) : formatMetric(value)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        ))
      )}
    </CardContent>
  </Card>
);

const AdminP4IntelligencePanel = () => {
  const intelligenceQuery = useQuery({
    queryKey: ["admin-p4-intelligence"],
    queryFn: async (): Promise<P4Payload> => {
      const requests = p4MetricRequests();
      const results = await Promise.allSettled(requests.map(({ promise }) => promise));

      return requests.reduce<P4Payload>(
        (payload, request, index) => {
          const result = results[index];
          if (result.status === "fulfilled") {
            payload[request.key] = result.value;
          } else {
            payload.failures.push({
              rpc: request.rpc,
              message: sanitizeAdminRpcErrorMessage(result.reason),
            });
          }
          return payload;
        },
        { failures: [] },
      );
    },
    refetchInterval: 120000,
  });

  const data = intelligenceQuery.data;
  const intelligenceFailures = data?.failures ?? [];
  const productMetrics = asRecord(data?.product?.metrics);
  const retentionMetrics = asRecord(data?.retention?.metrics);
  const revenueMetrics = asRecord(data?.revenue?.metrics);
  const derivedUsage = asRecord(data?.cost?.derived_usage);
  const unitEconomics = asRecord(data?.cost?.unit_economics);
  const matchFactors = asRecord(data?.matchQuality?.factors);
  const reportBlockSignals =
    typeof matchFactors.reports === "number" && typeof matchFactors.blocks === "number"
      ? matchFactors.reports + matchFactors.blocks
      : undefined;

  const overviewCards = useMemo<MetricCard[]>(
    () => [
      { label: "Verified New Profiles", value: productMetrics.verified_new_profiles, helper: "New profiles with at least one verified trust signal.", icon: CheckCircle2 },
      { label: "Event Registrations", value: productMetrics.event_registrations, helper: "Registrations, not confirmed attendance.", icon: Target },
      { label: "Matches", value: productMetrics.matches, helper: "Backend match rows in the selected window.", icon: Sparkles },
      { label: "Reports", value: productMetrics.reports, helper: "Trust signal volume, not automated enforcement.", icon: ShieldAlert },
    ],
    [productMetrics],
  );

  if (intelligenceQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-28 rounded-xl bg-secondary/40 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-36 rounded-xl bg-secondary/40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (intelligenceQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Unable to read P4 intelligence RPCs</AlertTitle>
        <AlertDescription>
          This is a backend read failure, not evidence that growth, trust, revenue, or cost systems are healthy.
        </AlertDescription>
      </Alert>
    );
  }

  const eventRows = asArray<Record<string, unknown>>(data?.eventLiquidity?.rows);
  const trustRows = asArray<Record<string, unknown>>(data?.trust?.rows);
  const authenticityRows = asArray<Record<string, unknown>>(data?.authenticity?.queue);
  const entitlementRows = asArray<Record<string, unknown>>(data?.entitlements?.rows);
  const qualityRows = asArray<Record<string, unknown>>(data?.quality?.rows);
  const storeChecklistRows = asArray<Record<string, unknown>>(data?.store?.metadata_checklists);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Brain className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold text-foreground">Growth-Scale Intelligence</h2>
              <Badge variant="outline">UTC</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Backend-defined P4 decision signals. Scores are advisory, explainable, and never change ranking, moderation, revenue, or compliance state by themselves.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => intelligenceQuery.refetch()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </section>

      {intelligenceFailures.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>P4 intelligence data is partially unavailable</AlertTitle>
          <AlertDescription>
            <div>Successful RPC sections are still shown below.</div>
            <div className="mt-2 space-y-1 text-xs">
              {intelligenceFailures.map((failure) => (
                <div key={failure.rpc}>
                  <span className="font-medium">{failure.rpc}</span>: {failure.message}
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="product" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="product">Product</TabsTrigger>
          <TabsTrigger value="events">Event Liquidity</TabsTrigger>
          <TabsTrigger value="matches">Match Quality</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="trust">Trust Triage</TabsTrigger>
          <TabsTrigger value="ops">Cost & Quality</TabsTrigger>
        </TabsList>

        <TabsContent value="product" className="space-y-4">
          <MetricGrid cards={overviewCards} />
          <MetricGrid
            cards={[
              { label: "Profile Photo Users", value: retentionMetrics.profile_photo_users, helper: "New users with profile media evidence.", icon: TrendingUp },
              { label: "Event Registered Users", value: retentionMetrics.event_registered_users, helper: "New-user cohort with registration evidence.", icon: BarChart3 },
              { label: "D7 Retained Users", value: retentionMetrics.d7_retained_users, helper: "UTC seven-day return proxy from last_seen_at.", icon: BarChart3 },
              { label: "D30 Retained Users", value: retentionMetrics.d30_retained_users, helper: "UTC thirty-day return proxy from last_seen_at.", icon: BarChart3 },
            ]}
          />
        </TabsContent>

        <TabsContent value="events" className="space-y-4">
          <SignalList
            title="Event Liquidity"
            description={String(data?.eventLiquidity?.score_semantics || "Deterministic planning score from existing backend truth.")}
            rows={eventRows}
            empty="No event liquidity rows were returned for this window."
          />
        </TabsContent>

        <TabsContent value="matches" className="space-y-4">
          <MetricGrid
            cards={[
              { label: "Match Quality Score", value: data?.matchQuality?.quality_score, helper: `Confidence: ${formatMetric(data?.matchQuality?.confidence)}`, icon: Sparkles },
              { label: "Matches", value: matchFactors.matches, helper: "Backend match rows in the selected window.", icon: Target },
              { label: "Completed Sessions", value: matchFactors.completed_sessions, helper: "Video sessions with ended_at evidence.", icon: CheckCircle2 },
              { label: "Reports + Blocks", value: reportBlockSignals, helper: "Safety signals included in the advisory score.", icon: ShieldAlert },
            ]}
          />
          <Alert>
            <Brain className="h-4 w-4" />
            <AlertTitle>Advisory model only</AlertTitle>
            <AlertDescription>
              Match quality signals are read-only in P4. They do not alter deck ranking, Daily Drop pairing, or enforcement without a later reviewed pass.
            </AlertDescription>
          </Alert>
        </TabsContent>

        <TabsContent value="revenue" className="space-y-4">
          <MetricGrid
            cards={[
              { label: "Active Subscriptions", value: revenueMetrics.active_subscriptions, helper: "Stripe + RevenueCat active/trialing.", icon: DollarSign },
              { label: "Premium Profiles", value: revenueMetrics.premium_profiles, helper: "Current profile entitlement rows.", icon: DollarSign },
              { label: "Entitlement Drift", value: revenueMetrics.entitlement_drift_users, helper: "Profiles differing from subscription evidence.", icon: AlertTriangle },
              { label: "Paid Event Registrations", value: revenueMetrics.paid_event_registrations, helper: "Windowed paid registration evidence.", icon: Target },
            ]}
          />
          <SignalList
            title="Entitlement Reconciliation"
            description={String(data?.entitlements?.semantics || "Backend entitlement drift evidence.")}
            rows={entitlementRows}
            empty="No entitlement rows were returned."
          />
        </TabsContent>

        <TabsContent value="trust" className="space-y-4">
          <SignalList
            title="Risk-Ranked Moderation Queue"
            description={String(data?.trust?.automation_policy || "Human-reviewed trust triage only.")}
            rows={trustRows}
            empty="No users currently need triage under the deterministic P4 score."
          />
          <SignalList
            title="Authenticity Operations"
            description="Verification funnel and media/authenticity recovery queues."
            rows={authenticityRows}
            empty="No authenticity queue rows were returned."
          />
        </TabsContent>

        <TabsContent value="ops" className="space-y-4">
          <MetricGrid
            cards={[
              { label: "Active Users", value: derivedUsage.active_users, helper: "Windowed active user proxy.", icon: TrendingUp },
              { label: "Events", value: derivedUsage.events, helper: "Windowed event rows.", icon: Target },
              { label: "Cost / Active User", value: unitEconomics.cost_per_active_user ?? "No data", helper: "Provider snapshot evidence only.", icon: DollarSign },
              { label: "Crash-Free Target", value: percent(0.99), helper: "Budget definition, not live provider proof.", icon: CheckCircle2 },
            ]}
          />
          <SignalList
            title="Quality Budgets"
            description={String(data?.quality?.semantics || "Missing observations are not passes.")}
            rows={qualityRows}
            empty="No quality budget definitions were returned."
          />
          <SignalList
            title="Store Operations Evidence"
            description={String(data?.store?.semantics || "Manual evidence ledger for native release operations.")}
            rows={storeChecklistRows}
            empty="No store metadata checklist rows were returned."
          />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
};

export default AdminP4IntelligencePanel;
