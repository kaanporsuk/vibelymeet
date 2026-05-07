import { useMemo, useState } from "react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { callAdminRpc, sanitizeAdminRpcErrorMessage, type AdminRpcPayload } from "@/lib/adminRpc";
import {
  asArray,
  asRecord,
  createDefaultP4Window,
  filterEntitlementDriftRows,
  isValidP4Window,
  normalizeAuthenticityRows,
  normalizeEntitlementRows,
  normalizeEventLiquidityRows,
  normalizeQualityBudgetRows,
  normalizeStoreChecklistRows,
  normalizeStoreReleaseRows,
  normalizeStoreReviewRows,
  normalizeTrustRows,
  splitEventLiquidityRows,
  type P4AuthenticityRow,
  type P4EntitlementRow,
  type P4EventLiquidityRow,
  type P4QualityBudgetRow,
  type P4StoreChecklistRow,
  type P4StoreReleaseRow,
  type P4StoreReviewRow,
  type P4TrustTriageRow,
  type P4Window,
} from "@clientShared/admin/p4IntelligenceAdapters";

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

type FactItem = {
  label: string;
  value: unknown;
};

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
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return (
      <Badge variant="outline" className="border-border/70 text-muted-foreground">
        Score unavailable
      </Badge>
    );
  }

  const numeric = score;
  const className =
    numeric >= 75
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : numeric >= 45
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-red-500/15 text-red-300 border-red-500/30";
  return <Badge className={className}>{numeric}/100</Badge>;
};

const formatCodeLabel = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) return "Unavailable";
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const formatTimestamp = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) return "Unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

const formatTarget = (comparison: unknown, target: unknown, unit: unknown): string => {
  const operator = comparison === "gte" ? ">=" : comparison === "lte" ? "<=" : formatMetric(comparison);
  const targetText = formatMetric(target);
  const unitText = typeof unit === "string" && unit.trim() ? unit : "";
  return `${operator} ${targetText}${unitText ? ` ${unitText}` : ""}`;
};

const statusBadge = (value: unknown) => {
  const text = formatCodeLabel(value);
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  const className =
    normalized.includes("healthy") || normalized.includes("approved") || normalized.includes("ready") || normalized.includes("within")
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : normalized.includes("missing") || normalized.includes("over") || normalized.includes("rejected") || normalized.includes("blocked") || normalized.includes("drift")
        ? "bg-red-500/15 text-red-300 border-red-500/30"
        : "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return <Badge className={className}>{text}</Badge>;
};

const FactGrid = ({ items }: { items: FactItem[] }) => (
  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
    {items.map((item) => (
      <div key={item.label} className="flex justify-between gap-3">
        <span>{item.label}</span>
        <span className="text-right text-foreground">{formatMetric(item.value)}</span>
      </div>
    ))}
  </div>
);

const toUtcDatetimeLocalValue = (iso: string): string => {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16) : "";
};

const fromUtcDatetimeLocalValue = (value: string, fallbackIso: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return fallbackIso;
  const normalized = trimmed.split(":").length >= 3 ? `${trimmed}Z` : `${trimmed}:00.000Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallbackIso;
};

const windowArgs = (window: P4Window) => ({
  p_window_start: window.start,
  p_window_end: window.end,
});

const p4MetricRequests = (window: P4Window): P4MetricRequest[] => [
  {
    key: "product",
    rpc: "admin_get_product_intelligence_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_product_intelligence_metrics", {
      ...windowArgs(window),
      p_filters: {},
    }),
  },
  {
    key: "retention",
    rpc: "admin_get_retention_activation_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_retention_activation_metrics", {
      ...windowArgs(window),
      p_filters: {},
    }),
  },
  {
    key: "eventLiquidity",
    rpc: "admin_get_event_liquidity_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_event_liquidity_metrics", {
      p_event_id: null,
      ...windowArgs(window),
    }),
  },
  {
    key: "matchQuality",
    rpc: "admin_get_match_quality_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_match_quality_metrics", {
      ...windowArgs(window),
      p_filters: {},
    }),
  },
  {
    key: "revenue",
    rpc: "admin_get_revenue_intelligence",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_revenue_intelligence", {
      ...windowArgs(window),
      p_filters: {},
    }),
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
      p_filters: { window_start: window.start, window_end: window.end },
      p_limit: 25,
      p_offset: 0,
    }),
  },
  {
    key: "authenticity",
    rpc: "admin_get_authenticity_operations",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_authenticity_operations", {
      p_filters: { window_start: window.start, window_end: window.end },
    }),
  },
  {
    key: "cost",
    rpc: "admin_get_cost_capacity_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_cost_capacity_metrics", windowArgs(window)),
  },
  {
    key: "quality",
    rpc: "admin_get_quality_scorecard",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_quality_scorecard", {}),
  },
  {
    key: "store",
    rpc: "admin_get_store_operations_metrics",
    promise: callAdminRpc<AdminMetricPayload>("admin_get_store_operations_metrics", windowArgs(window)),
  },
];

const MetricGrid = ({ cards }: { cards: MetricCard[] }) => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
          {card.helper ? <CardContent className="pt-0 text-xs text-muted-foreground">{card.helper}</CardContent> : null}
        </Card>
      );
    })}
  </div>
);

const EventRows = ({
  title,
  description,
  rows,
  empty,
}: {
  title: string;
  description: string;
  rows: P4EventLiquidityRow[];
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
        rows.map((row, index) => (
          <div key={row.eventId || `${row.title}-${index}`} className="rounded-md border border-border/60 bg-secondary/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="font-medium text-foreground">{row.title}</div>
                <div className="font-mono text-xs text-muted-foreground">{row.eventId || "Unavailable"}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {row.recommendation ? statusBadge(row.recommendation) : null}
                {scoreBadge(row.score)}
              </div>
            </div>
            <FactGrid
              items={[
                { label: "Event date", value: formatTimestamp(row.eventDate) },
                { label: "Market", value: row.market },
                { label: "Status", value: row.rawStatus },
                { label: "Confidence", value: row.confidence },
                { label: "Registrations / capacity", value: `${formatMetric(row.registrations)} / ${formatMetric(row.capacity)}` },
                { label: "Confirmed", value: row.confirmed },
                { label: "Lobby participants", value: row.lobbyParticipants },
                { label: "Gender balance", value: `${formatMetric(row.men)} / ${formatMetric(row.women)} / ${formatMetric(row.otherGender)}` },
                { label: "Photo verified", value: row.photoVerified },
                { label: "Premium", value: row.premium },
                { label: "Completed sessions", value: row.completedSessions },
                { label: "Matches", value: row.matches },
                { label: "Positive swipes", value: row.positiveSwipes },
                { label: "Participant reports", value: row.participantReports },
              ]}
            />
          </div>
        ))
      )}
    </CardContent>
  </Card>
);

const EventLiquiditySection = ({
  activeRows,
  archivedRows,
  semantics,
}: {
  activeRows: P4EventLiquidityRow[];
  archivedRows: P4EventLiquidityRow[];
  semantics: string;
}) => (
  <div className="space-y-4">
    <EventRows
      title="Event Liquidity"
      description={semantics}
      rows={activeRows}
      empty="No active event liquidity rows were returned for this window."
    />
    <EventRows
      title="Archived Event Liquidity"
      description="Archived rows are separated so stale event screenshots do not dilute active planning signals."
      rows={archivedRows}
      empty="No archived event liquidity rows were returned."
    />
  </div>
);

const EntitlementReconciliationSection = ({
  rows,
  semantics,
}: {
  rows: P4EntitlementRow[];
  semantics: string;
}) => (
  <Card className="rounded-lg">
    <CardHeader>
      <CardTitle className="text-lg">Entitlement Reconciliation</CardTitle>
      <CardDescription>{`${semantics} Profiles with matching subscription/admin-grant state are hidden from this queue.`}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entitlement drift found.</p>
      ) : (
        rows.map((row, index) => (
          <div key={row.userId || `entitlement-${index}`} className="rounded-md border border-border/60 bg-secondary/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="font-medium text-foreground">{row.name || row.userId}</div>
                <div className="font-mono text-xs text-muted-foreground">{row.userId}</div>
              </div>
              {statusBadge("drift")}
            </div>
            <FactGrid
              items={[
                { label: "Profile is premium", value: row.profileIsPremium },
                { label: "Should be premium", value: row.entitlementShouldBePremium },
                { label: "Active subscription", value: row.hasActiveSubscription },
                { label: "Active admin grant", value: row.hasActiveAdminGrant },
                { label: "Premium until", value: formatTimestamp(row.premiumUntil) },
                { label: "Subscription tier", value: row.subscriptionTier },
                { label: "Subscription evidence", value: row.subscriptions.length },
              ]}
            />
          </div>
        ))
      )}
    </CardContent>
  </Card>
);

const TrustTriageSection = ({
  rows,
  automationPolicy,
}: {
  rows: P4TrustTriageRow[];
  automationPolicy: string;
}) => (
  <Card className="rounded-lg">
    <CardHeader>
      <CardTitle className="text-lg">Risk-Ranked Moderation Queue</CardTitle>
      <CardDescription>{automationPolicy}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users currently need triage under the deterministic P4 score.</p>
      ) : (
        rows.map((row, index) => (
          <div key={row.userId || `trust-${index}`} className="rounded-md border border-border/60 bg-secondary/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="font-medium text-foreground">{row.name || row.userId}</div>
                <div className="font-mono text-xs text-muted-foreground">{row.userId}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {row.recommendedAction ? statusBadge(row.recommendedAction) : null}
                {scoreBadge(row.riskScore)}
              </div>
            </div>
            <FactGrid
              items={[
                { label: "Confidence", value: row.confidence },
                { label: "Pending reports", value: row.pendingReports },
                { label: "Total reports", value: row.totalReports },
                { label: "Blocks received", value: row.blocksReceived },
                { label: "Warnings", value: row.warnings },
                { label: "Active suspensions", value: row.activeSuspensions },
                { label: "Verification attempts", value: row.verificationAttempts },
                { label: "Possible no-shows", value: row.possibleNoShows },
              ]}
            />
          </div>
        ))
      )}
    </CardContent>
  </Card>
);

const AuthenticityOperationsSection = ({
  metrics,
  rows,
  automationPolicy,
}: {
  metrics: AdminMetricPayload;
  rows: P4AuthenticityRow[];
  automationPolicy: string;
}) => (
  <div className="space-y-4">
    <MetricGrid
      cards={[
        { label: "Pending Verifications", value: metrics.pending_verifications, helper: "Awaiting human review.", icon: Target },
        { label: "Rejected Verifications", value: metrics.rejected_verifications, helper: "Recovery queue evidence.", icon: ShieldAlert },
        { label: "Expired Verified Profiles", value: metrics.expired_verified_profiles, helper: "Verified profiles past expiry.", icon: AlertTriangle },
        { label: "Repeated Failed Attempts", value: metrics.users_with_repeated_failed_attempts_7d, helper: "Seven-day repeated failure signal.", icon: Brain },
      ]}
    />
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-lg">Authenticity Operations</CardTitle>
        <CardDescription>{automationPolicy}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No authenticity queue rows were returned.</p>
        ) : (
          rows.map((row, index) => (
            <div key={row.verificationId || `${row.userId}-${index}`} className="rounded-md border border-border/60 bg-secondary/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-medium text-foreground">{row.verificationId || "Verification"}</div>
                  <div className="font-mono text-xs text-muted-foreground">{row.userId || "Unavailable"}</div>
                </div>
                {row.status ? statusBadge(row.status) : null}
              </div>
              <FactGrid
                items={[
                  { label: "Created", value: formatTimestamp(row.createdAt) },
                  { label: "Expires", value: formatTimestamp(row.expiresAt) },
                  { label: "Client confidence", value: row.clientConfidenceScore },
                  { label: "Client match result", value: row.clientMatchResult },
                ]}
              />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  </div>
);

const QualityBudgetsSection = ({
  rows,
  semantics,
}: {
  rows: P4QualityBudgetRow[];
  semantics: string;
}) => (
  <Card className="rounded-lg">
    <CardHeader>
      <CardTitle className="text-lg">Quality Budgets</CardTitle>
      <CardDescription>{semantics}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No quality budget definitions were returned.</p>
      ) : (
        rows.map((row, index) => (
          <div key={row.budgetKey || `quality-${index}`} className="rounded-md border border-border/60 bg-secondary/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="font-medium text-foreground">{row.label || row.budgetKey}</div>
                <div className="font-mono text-xs text-muted-foreground">{row.budgetKey}</div>
              </div>
              {row.status ? statusBadge(row.status) : null}
            </div>
            <FactGrid
              items={[
                { label: "Domain", value: row.domain },
                { label: "Target", value: formatTarget(row.comparison, row.targetValue, row.unit) },
                { label: "Latest observed", value: row.latestObservedValue === null ? "Missing" : `${formatMetric(row.latestObservedValue)} ${row.unit || ""}`.trim() },
                { label: "Release", value: row.latestReleaseVersion },
                { label: "Observed at", value: formatTimestamp(row.latestObservedAt) },
              ]}
            />
          </div>
        ))
      )}
    </CardContent>
  </Card>
);

const StoreOperationsSection = ({
  checklists,
  releases,
  reviews,
  semantics,
}: {
  checklists: P4StoreChecklistRow[];
  releases: P4StoreReleaseRow[];
  reviews: P4StoreReviewRow[];
  semantics: string;
}) => {
  const hasRows = checklists.length > 0 || releases.length > 0 || reviews.length > 0;

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-lg">Store Operations Evidence</CardTitle>
        <CardDescription>{semantics}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasRows ? <p className="text-sm text-muted-foreground">No store operations rows were returned.</p> : null}

        {checklists.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Metadata Checklists</h3>
            {checklists.map((row, index) => (
              <div key={`${row.platform || "platform"}-${row.checklistKey || index}`} className="rounded-md border border-border/60 bg-secondary/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="font-medium text-foreground">{formatCodeLabel(row.checklistKey)}</div>
                  {row.status ? statusBadge(row.status) : null}
                </div>
                <FactGrid
                  items={[
                    { label: "Platform", value: row.platform },
                    { label: "Updated", value: formatTimestamp(row.updatedAt) },
                  ]}
                />
              </div>
            ))}
          </div>
        ) : null}

        {releases.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Native Release Runs</h3>
            {releases.map((row, index) => (
              <div key={`${row.platform || "platform"}-${row.releaseVersion || "release"}-${row.buildNumber || row.createdAt || index}`} className="rounded-md border border-border/60 bg-secondary/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">{row.releaseVersion || "Release"}</div>
                    <div className="font-mono text-xs text-muted-foreground">{row.buildNumber || "No build number"}</div>
                  </div>
                  {row.status ? statusBadge(row.status) : null}
                </div>
                <FactGrid
                  items={[
                    { label: "Platform", value: row.platform },
                    { label: "Channel", value: row.channel },
                    { label: "Created", value: formatTimestamp(row.createdAt) },
                    { label: "Started", value: formatTimestamp(row.startedAt) },
                    { label: "Completed", value: formatTimestamp(row.completedAt) },
                  ]}
                />
              </div>
            ))}
          </div>
        ) : null}

        {reviews.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Store Review Events</h3>
            {reviews.map((row, index) => (
              <div key={row.reviewId || `${row.platform || "platform"}-${row.observedAt || index}`} className="rounded-md border border-border/60 bg-secondary/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="font-medium text-foreground">{row.category ? formatCodeLabel(row.category) : row.reviewId || "Review"}</div>
                  {row.actionStatus ? statusBadge(row.actionStatus) : null}
                </div>
                <FactGrid
                  items={[
                    { label: "Platform", value: row.platform },
                    { label: "Release", value: row.releaseVersion },
                    { label: "Rating", value: row.rating },
                    { label: "Sentiment", value: row.sentiment },
                    { label: "Observed", value: formatTimestamp(row.observedAt) },
                  ]}
                />
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

const AdminP4IntelligencePanel = () => {
  const [p4Window, setP4Window] = useState<P4Window>(() => createDefaultP4Window());
  const windowValid = isValidP4Window(p4Window);

  const intelligenceQuery = useQuery({
    queryKey: ["admin-p4-intelligence", p4Window.start, p4Window.end],
    queryFn: async (): Promise<P4Payload> => {
      const requests = p4MetricRequests(p4Window);
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
    enabled: windowValid,
    refetchInterval: 120_000,
  });

  const data = intelligenceQuery.data;
  const productMetrics = asRecord(data?.product?.metrics);
  const retentionMetrics = asRecord(data?.retention?.metrics);
  const revenueMetrics = asRecord(data?.revenue?.metrics);
  const derivedUsage = asRecord(data?.cost?.derived_usage);
  const unitEconomics = asRecord(data?.cost?.unit_economics);
  const matchFactors = asRecord(data?.matchQuality?.factors);
  const authenticityMetrics = asRecord(data?.authenticity?.metrics);
  const eventLiquidity = splitEventLiquidityRows(normalizeEventLiquidityRows(data?.eventLiquidity?.rows));
  const entitlementRows = normalizeEntitlementRows(data?.entitlements?.rows);
  const trustRows = normalizeTrustRows(data?.trust?.rows);
  const authenticityRows = normalizeAuthenticityRows(data?.authenticity?.queue);
  const qualityRows = normalizeQualityBudgetRows(data?.quality?.rows);
  const storeChecklistRows = normalizeStoreChecklistRows(data?.store?.metadata_checklists);
  const storeReleaseRows = normalizeStoreReleaseRows(data?.store?.release_runs);
  const storeReviewRows = normalizeStoreReviewRows(data?.store?.review_events);
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
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
            <p className="text-xs text-muted-foreground">
              Window: {formatTimestamp(p4Window.start)} to {formatTimestamp(p4Window.end)}. Current-state queues remain labeled as queues.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Start (UTC)</span>
              <Input
                type="datetime-local"
                value={toUtcDatetimeLocalValue(p4Window.start)}
                onChange={(event) =>
                  setP4Window((current) => ({
                    ...current,
                    start: fromUtcDatetimeLocalValue(event.target.value, current.start),
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>End (UTC)</span>
              <Input
                type="datetime-local"
                value={toUtcDatetimeLocalValue(p4Window.end)}
                onChange={(event) =>
                  setP4Window((current) => ({
                    ...current,
                    end: fromUtcDatetimeLocalValue(event.target.value, current.end),
                  }))
                }
              />
            </label>
            <Button variant="outline" size="sm" className="gap-2" disabled={!windowValid} onClick={() => void intelligenceQuery.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
        {!windowValid && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            Start (UTC) must be before End (UTC).
          </div>
        )}
      </section>

      {asArray<P4Failure>(data?.failures).length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>P4 intelligence data is partially unavailable</AlertTitle>
          <AlertDescription>
            <div>Successful RPC sections are still shown below.</div>
            <div className="mt-2 space-y-1 text-xs">
              {asArray<P4Failure>(data?.failures).map((failure) => (
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
          <EventLiquiditySection
            activeRows={eventLiquidity.activeRows}
            archivedRows={eventLiquidity.archivedRows}
            semantics={String(data?.eventLiquidity?.score_semantics || "Deterministic planning score from existing backend truth.")}
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
          <EntitlementReconciliationSection
            semantics={String(data?.entitlements?.semantics || "Backend entitlement drift evidence.")}
            rows={filterEntitlementDriftRows(entitlementRows)}
          />
        </TabsContent>

        <TabsContent value="trust" className="space-y-4">
          <TrustTriageSection
            rows={trustRows}
            automationPolicy={String(data?.trust?.automation_policy || "Human-reviewed trust triage only.")}
          />
          <AuthenticityOperationsSection
            metrics={authenticityMetrics}
            rows={authenticityRows}
            automationPolicy={String(data?.authenticity?.automation_policy || "Authenticity signals prioritize human review and recovery.")}
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
          <QualityBudgetsSection
            semantics={String(data?.quality?.semantics || "Missing observations are not passes.")}
            rows={qualityRows}
          />
          <StoreOperationsSection
            semantics={String(data?.store?.semantics || "Manual evidence ledger for native release operations.")}
            checklists={storeChecklistRows}
            releases={storeReleaseRows}
            reviews={storeReviewRows}
          />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
};

export default AdminP4IntelligencePanel;
