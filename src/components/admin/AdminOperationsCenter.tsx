import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Bell,
  CreditCard,
  Database,
  FileSearch,
  LockKeyhole,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatAdminRelativeTime } from "@/lib/adminTime";
import { resolveAdminErrorMessage } from "@/lib/adminErrorResolver";

type OpsStatus = "healthy" | "degraded" | "incident" | "unknown" | "unavailable" | string;

type HealthArea = {
  id: string;
  label: string;
  status: OpsStatus;
  primary_count?: number;
  primary_label?: string;
  details?: Record<string, unknown>;
};

type ProviderCheck = {
  id: string;
  label: string;
  status: OpsStatus;
  app_truth?: Record<string, unknown>;
  provider_truth?: Record<string, unknown>;
  drift_count?: number;
};

type IncidentSignal = {
  severity: string;
  type: string;
  title: string;
  count?: number;
  next_step?: string;
};

type AuditRow = {
  id: string;
  admin_id: string | null;
  admin_name: string | null;
  action_type: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  request_id?: string | null;
  correlation_id?: string | null;
  action_outcome?: string | null;
  error_code?: string | null;
  created_at: string;
};

type RebuildRehearsalSummary = {
  id?: string | null;
  status?: OpsStatus | null;
  scope?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  notes?: string | null;
  source?: string | null;
  provider_smoke?: string | null;
};

type AdminPermissionCatalogItem = {
  permission: string;
  area?: string | null;
  label?: string | null;
  description?: string | null;
  is_break_glass?: boolean | null;
};

type SystemHealthPayload = AdminRpcPayload & {
  generated_at?: string;
  overall_status?: OpsStatus;
  reporting_timezone?: string;
  health_areas?: HealthArea[];
};

type ProviderHealthPayload = AdminRpcPayload & {
  generated_at?: string;
  overall_status?: OpsStatus;
  provider_checks_are_app_layer_only?: boolean;
  providers?: ProviderCheck[];
};

type RebuildStatusPayload = AdminRpcPayload & {
  status?: OpsStatus;
  migration_count?: number;
  latest_migration?: string | null;
  classified_migrations?: number;
  unclassified_migrations?: number;
  classification_coverage_pct?: number;
  rebuild_rehearsal_count?: number;
  passed_rebuild_rehearsal_count?: number;
  latest_rehearsal_summary?: RebuildRehearsalSummary | null;
  degraded_reasons?: string[];
  expected_functions?: string[];
  provider_inventory_required?: string[];
};

type IncidentSignalsPayload = AdminRpcPayload & {
  status?: OpsStatus;
  signals?: IncidentSignal[];
};

type PermissionsPayload = AdminRpcPayload & {
  roles?: string[];
  permissions?: string[];
  catalog?: AdminPermissionCatalogItem[];
  permission_model?: string;
};

type AuditPayload = AdminRpcPayload & {
  rows?: AuditRow[];
  total_count?: number;
  limit?: number;
  offset?: number;
};

type OperationsRpcName =
  | "admin_get_system_health"
  | "admin_get_provider_health"
  | "admin_get_rebuild_status"
  | "admin_get_incident_signals"
  | "admin_get_admin_permissions";

type OperationsFailure = {
  rpc: OperationsRpcName;
  message: string;
};

type OperationsData = {
  system?: SystemHealthPayload;
  providers?: ProviderHealthPayload;
  rebuild?: RebuildStatusPayload;
  incidents?: IncidentSignalsPayload;
  permissions?: PermissionsPayload;
  failures: OperationsFailure[];
};

const statusClasses: Record<string, string> = {
  healthy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  degraded: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  incident: "bg-red-500/15 text-red-300 border-red-500/30",
  unknown: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  unavailable: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

const providerIcons: Record<string, LucideIcon> = {
  stripe: CreditCard,
  bunny: Video,
  daily: Activity,
  onesignal: Bell,
  supabase: Database,
};

const statusRank = (status: OpsStatus | undefined): number => {
  if (status === "incident") return 3;
  if (status === "degraded") return 2;
  if (status === "healthy") return 1;
  return 0;
};

const normalizeStatus = (status: OpsStatus | undefined): OpsStatus => status || "unknown";

const statusBadge = (status: OpsStatus | undefined) => {
  const normalized = normalizeStatus(status);
  return (
    <Badge className={statusClasses[normalized] || statusClasses.unknown}>
      {normalized}
    </Badge>
  );
};

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const formatCount = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "0";

const formatPercent = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString()}%` : "0%";

const formatRelativeTime = (value: unknown): string => {
  if (typeof value !== "string" || !value) return "unknown time";
  return formatAdminRelativeTime(value);
};

const shortenId = (value: string): string => value.length <= 16 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;

const auditOutcomeClass = (outcome: string | null | undefined): string => {
  const normalized = (outcome ?? "").toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("blocked")) return statusClasses.incident;
  if (normalized.includes("warn") || normalized.includes("retry") || normalized.includes("queued")) return statusClasses.degraded;
  if (normalized.includes("success") || normalized.includes("complete")) return statusClasses.healthy;
  return statusClasses.unknown;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return uuidPattern.test(trimmed) ? trimmed : null;
};

const toIsoOrNull = (value: string): string | null => {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const factRows = (value: Record<string, unknown> | undefined) =>
  Object.entries(value || {}).map(([key, entry]) => (
    <div key={key} className="flex items-start justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{key.replace(/_/g, " ")}</span>
      <span className="text-right font-medium text-foreground">
        {typeof entry === "object" && entry !== null ? JSON.stringify(entry) : String(entry)}
      </span>
    </div>
  ));

const fulfilledValue = <T,>(result: PromiseSettledResult<T>): T | undefined =>
  result.status === "fulfilled" ? result.value : undefined;

const failureFor = (rpc: OperationsRpcName, result: PromiseSettledResult<unknown>): OperationsFailure | null =>
  result.status === "rejected" ? { rpc, message: resolveAdminErrorMessage(result.reason, `${rpc} failed`) } : null;

const unavailableSection = (label: string, rpc: OperationsRpcName, failures: OperationsFailure[]) => {
  const failure = failures.find((item) => item.rpc === rpc);
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <div className="font-medium">{label} unavailable</div>
      <div className="mt-1 text-xs">{failure ? `${rpc}: ${failure.message}` : rpc}</div>
    </div>
  );
};

const AdminOperationsCenter = () => {
  const [auditAction, setAuditAction] = useState("");
  const [auditTargetType, setAuditTargetType] = useState("");
  const [auditTargetId, setAuditTargetId] = useState("");
  const [auditActorId, setAuditActorId] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");

  const debouncedAuditAction = useDebouncedValue(auditAction);
  const debouncedAuditTargetType = useDebouncedValue(auditTargetType);
  const debouncedAuditTargetId = useDebouncedValue(auditTargetId);
  const debouncedAuditActorId = useDebouncedValue(auditActorId);
  const debouncedAuditFrom = useDebouncedValue(auditFrom);
  const debouncedAuditTo = useDebouncedValue(auditTo);
  const targetIdInvalid = Boolean(auditTargetId.trim()) && !uuidOrNull(auditTargetId);
  const actorIdInvalid = Boolean(auditActorId.trim()) && !uuidOrNull(auditActorId);
  const debouncedTargetIdInvalid = Boolean(debouncedAuditTargetId.trim()) && !uuidOrNull(debouncedAuditTargetId);
  const debouncedActorIdInvalid = Boolean(debouncedAuditActorId.trim()) && !uuidOrNull(debouncedAuditActorId);
  const auditUuidFiltersInvalid = targetIdInvalid || actorIdInvalid || debouncedTargetIdInvalid || debouncedActorIdInvalid;

  const opsQuery = useQuery<OperationsData>({
    queryKey: ["admin-operations-center"],
    queryFn: async () => {
      const [system, providers, rebuild, incidents, permissions] = await Promise.allSettled([
        callAdminRpc<SystemHealthPayload>("admin_get_system_health", {}),
        callAdminRpc<ProviderHealthPayload>("admin_get_provider_health", {}),
        callAdminRpc<RebuildStatusPayload>("admin_get_rebuild_status", {}),
        callAdminRpc<IncidentSignalsPayload>("admin_get_incident_signals", {}),
        callAdminRpc<PermissionsPayload>("admin_get_admin_permissions", {}),
      ]);

      return {
        system: fulfilledValue(system),
        providers: fulfilledValue(providers),
        rebuild: fulfilledValue(rebuild),
        incidents: fulfilledValue(incidents),
        permissions: fulfilledValue(permissions),
        failures: [
          failureFor("admin_get_system_health", system),
          failureFor("admin_get_provider_health", providers),
          failureFor("admin_get_rebuild_status", rebuild),
          failureFor("admin_get_incident_signals", incidents),
          failureFor("admin_get_admin_permissions", permissions),
        ].filter((failure): failure is OperationsFailure => Boolean(failure)),
      };
    },
    refetchInterval: 60000,
  });

  const auditQuery = useQuery({
    queryKey: [
      "admin-operations-audit",
      debouncedAuditAction,
      debouncedAuditTargetType,
      debouncedAuditTargetId,
      debouncedAuditActorId,
      debouncedAuditFrom,
      debouncedAuditTo,
    ],
    queryFn: async () =>
      callAdminRpc<AuditPayload>("admin_search_admin_audit_logs", {
        p_action_type: debouncedAuditAction.trim() || null,
        p_target_type: debouncedAuditTargetType.trim() || null,
        p_target_id: uuidOrNull(debouncedAuditTargetId),
        p_actor_id: uuidOrNull(debouncedAuditActorId),
        p_from: toIsoOrNull(debouncedAuditFrom),
        p_to: toIsoOrNull(debouncedAuditTo),
        p_limit: 25,
        p_offset: 0,
      }),
    enabled: !auditUuidFiltersInvalid,
  });

  const overallStatus = useMemo(() => {
    const statuses = [
      opsQuery.data?.system?.overall_status,
      opsQuery.data?.providers?.overall_status,
      opsQuery.data?.rebuild?.status,
      opsQuery.data?.incidents?.status,
    ];
    if (opsQuery.data?.failures.length) statuses.push("degraded");
    if (opsQuery.data?.failures.length && statuses.every((status) => !status)) return "unavailable";
    return statuses.sort((a, b) => statusRank(b) - statusRank(a))[0] || "unknown";
  }, [opsQuery.data]);

  const operationFailures = opsQuery.data?.failures ?? [];
  const system = opsQuery.data?.system;
  const providers = opsQuery.data?.providers;
  const rebuild = opsQuery.data?.rebuild;
  const incidents = opsQuery.data?.incidents;
  const permissions = opsQuery.data?.permissions;
  const healthAreas = asArray<HealthArea>(system?.health_areas);
  const providerChecks = asArray<ProviderCheck>(providers?.providers);
  const incidentSignals = asArray<IncidentSignal>(incidents?.signals);
  const auditRows = asArray<AuditRow>(auditQuery.data?.rows);
  const rebuildDegradedReasons = asArray<string>(rebuild?.degraded_reasons);
  const latestRehearsal = rebuild?.latest_rehearsal_summary;
  const auditFiltersActive = Boolean(
    auditAction.trim() ||
      auditTargetType.trim() ||
      auditTargetId.trim() ||
      auditActorId.trim() ||
      auditFrom.trim() ||
      auditTo.trim(),
  );
  const permissionCatalogByArea = useMemo(() => {
    const grantedPermissions = asArray<string>(permissions?.permissions);
    const granted = new Set(grantedPermissions);
    const catalog = asArray<AdminPermissionCatalogItem>(permissions?.catalog);
    const rows = catalog.length
      ? catalog.filter((item) => granted.has(item.permission))
      : grantedPermissions.map((permission) => ({ permission, area: "Granted" }));

    return rows.reduce<Record<string, AdminPermissionCatalogItem[]>>((acc, item) => {
      const area = item.area || "Granted";
      acc[area] = [...(acc[area] || []), item];
      return acc;
    }, {});
  }, [permissions]);

  const clearAuditFilters = () => {
    setAuditAction("");
    setAuditTargetType("");
    setAuditTargetId("");
    setAuditActorId("");
    setAuditFrom("");
    setAuditTo("");
  };

  if (opsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-28 rounded-xl bg-secondary/40 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-40 rounded-xl bg-secondary/40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {operationFailures.length > 0 && (
        <section className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
          <div className="font-medium">
            Operations data is partially unavailable. Successful RPC sections are still shown below.
          </div>
          <div className="mt-2 space-y-1 text-xs">
            {operationFailures.map((failure) => (
              <div key={failure.rpc}>
                <span className="font-medium">{failure.rpc}</span>: {failure.message}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Server className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold text-foreground">Operations Center</h2>
              {statusBadge(overallStatus)}
            </div>
            <p className="text-sm text-muted-foreground">
              UTC health signals from backend admin RPCs. Provider checks separate app-layer truth from external provider truth.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-border text-muted-foreground">
              {system?.reporting_timezone || "UTC"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                opsQuery.refetch();
                if (!auditUuidFiltersInvalid) {
                  auditQuery.refetch();
                }
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {system ? (
          healthAreas.map((area) => (
            <div key={area.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{area.label}</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">
                    {formatCount(area.primary_count)}
                  </div>
                  <div className="text-xs text-muted-foreground">{area.primary_label}</div>
                </div>
                {statusBadge(area.status)}
              </div>
              <div className="mt-4 space-y-1.5">{factRows(area.details)}</div>
            </div>
          ))
        ) : (
          <div className="md:col-span-2 xl:col-span-3">
            {unavailableSection("System health", "admin_get_system_health", operationFailures)}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Provider Reconciliation</h3>
          </div>
          <div className="flex items-center gap-2">
            {providers?.provider_checks_are_app_layer_only && (
              <Badge variant="outline" className="border-border text-muted-foreground">
                app-layer only
              </Badge>
            )}
            {statusBadge(providers?.overall_status)}
          </div>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Provider truth is manual: this RPC reads Supabase app telemetry and does not contact Stripe, Bunny, Daily, or OneSignal APIs.
        </p>
        {providers ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {providerChecks.map((provider) => {
              const Icon = providerIcons[provider.id] || Server;
              return (
                <div key={provider.id} className="rounded-lg border border-border/70 bg-secondary/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="font-medium text-foreground">{provider.label}</span>
                    </div>
                    {statusBadge(provider.status)}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">App Truth</div>
                      {factRows(provider.app_truth)}
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">Provider Truth</div>
                      {factRows(provider.provider_truth)}
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    Drift count: <span className="font-medium text-foreground">{formatCount(provider.drift_count)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          unavailableSection("Provider reconciliation", "admin_get_provider_health", operationFailures)
        )}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">Incident Signals</h3>
            </div>
            {statusBadge(incidents?.status)}
          </div>
          {!incidents ? (
            unavailableSection("Incident signals", "admin_get_incident_signals", operationFailures)
          ) : incidentSignals.length === 0 ? (
            <div className="rounded-lg border border-border/70 bg-secondary/20 p-4 text-sm text-muted-foreground">
              No incident signals are currently visible from app-layer telemetry.
            </div>
          ) : (
            <div className="space-y-3">
              {incidentSignals.map((signal) => (
                <div key={`${signal.type}-${signal.severity}`} className="rounded-lg border border-border/70 bg-secondary/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">{signal.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{signal.type}</div>
                    </div>
                    <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">
                      {signal.severity}
                    </Badge>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    Count: <span className="font-medium text-foreground">{formatCount(signal.count)}</span>
                  </div>
                  {signal.next_step && (
                    <div className="mt-2 text-xs text-muted-foreground">{signal.next_step}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">Rebuild Governance</h3>
            </div>
            {statusBadge(rebuild?.status)}
          </div>
          {rebuild ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                  <div className="text-xs text-muted-foreground">Migrations</div>
                  <div className="text-xl font-semibold text-foreground">{formatCount(rebuild.migration_count)}</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                  <div className="text-xs text-muted-foreground">Coverage</div>
                  <div className="text-xl font-semibold text-foreground">{formatPercent(rebuild.classification_coverage_pct)}</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                  <div className="text-xs text-muted-foreground">Unclassified</div>
                  <div className="text-xl font-semibold text-foreground">{formatCount(rebuild.unclassified_migrations)}</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                  <div className="text-xs text-muted-foreground">Passed Rehearsals</div>
                  <div className="text-xl font-semibold text-foreground">
                    {formatCount(rebuild.passed_rebuild_rehearsal_count)}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Classified migrations: <span className="text-foreground">{formatCount(rebuild.classified_migrations)}</span>
                {" "}of <span className="text-foreground">{formatCount(rebuild.migration_count)}</span>
              </div>
              {rebuildDegradedReasons.length > 0 ? (
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <div className="font-medium">Governance drivers</div>
                  <div className="mt-2 space-y-1">
                    {rebuildDegradedReasons.map((reason) => (
                      <div key={reason}>{reason}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                  Governance ledger is complete for applied migrations and passed rehearsal evidence.
                </div>
              )}
              {latestRehearsal && (
                <div className="mt-4 rounded-lg border border-border/70 bg-secondary/20 p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">Latest rehearsal</span>
                    {statusBadge(latestRehearsal.status || "unknown")}
                    <span className="text-muted-foreground">{latestRehearsal.scope || "unknown scope"}</span>
                  </div>
                  <div className="mt-2 text-muted-foreground">
                    Completed: <span className="text-foreground">{formatRelativeTime(latestRehearsal.completed_at)}</span>
                  </div>
                  {latestRehearsal.source && (
                    <div className="mt-1 text-muted-foreground">
                      Source: <span className="text-foreground">{latestRehearsal.source}</span>
                    </div>
                  )}
                  {latestRehearsal.notes && (
                    <div className="mt-2 text-muted-foreground">{latestRehearsal.notes}</div>
                  )}
                </div>
              )}
              <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                <div>Latest migration: <span className="text-foreground">{rebuild.latest_migration || "unknown"}</span></div>
                <div>Expected functions: {asArray<string>(rebuild.expected_functions).join(", ") || "unknown"}</div>
              </div>
            </>
          ) : (
            unavailableSection("Rebuild governance", "admin_get_rebuild_status", operationFailures)
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Admin Audit Explorer</h3>
            {auditQuery.isFetching && !auditQuery.isLoading && (
              <Badge variant="outline" className="border-border text-muted-foreground">
                refreshing
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-7">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={auditAction}
                onChange={(event) => setAuditAction(event.target.value)}
                aria-label="Filter audit logs by action type"
                placeholder="action type"
                className="w-full pl-8"
              />
            </div>
            <Input
              value={auditTargetType}
              onChange={(event) => setAuditTargetType(event.target.value)}
              aria-label="Filter audit logs by target type"
              placeholder="target type"
              className="w-full"
            />
            <Input
              value={auditTargetId}
              onChange={(event) => setAuditTargetId(event.target.value)}
              aria-label="Filter audit logs by target id"
              placeholder="target uuid"
              className={targetIdInvalid ? "border-destructive" : ""}
            />
            <Input
              value={auditActorId}
              onChange={(event) => setAuditActorId(event.target.value)}
              aria-label="Filter audit logs by actor id"
              placeholder="actor uuid"
              className={actorIdInvalid ? "border-destructive" : ""}
            />
            <Input
              type="datetime-local"
              value={auditFrom}
              onChange={(event) => setAuditFrom(event.target.value)}
              aria-label="Filter audit logs from timestamp"
            />
            <Input
              type="datetime-local"
              value={auditTo}
              onChange={(event) => setAuditTo(event.target.value)}
              aria-label="Filter audit logs to timestamp"
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={clearAuditFilters}
              disabled={!auditFiltersActive}
            >
              <X className="h-4 w-4" />
              Clear
            </Button>
          </div>
        </div>
        {auditUuidFiltersInvalid ? (
          <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            UUID filters pause search until they contain a valid UUID.
          </div>
        ) : auditQuery.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Unable to read audit logs from admin_search_admin_audit_logs.
          </div>
        ) : auditQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-16 rounded-lg bg-secondary/40 animate-pulse" />
            ))}
          </div>
        ) : auditRows.length === 0 ? (
          <div className="rounded-lg border border-border/70 bg-secondary/20 p-4 text-sm text-muted-foreground">
            No audit rows match the current filters.
          </div>
        ) : (
          <div className="space-y-2">
            {auditRows.map((row) => (
              <div key={row.id} className="rounded-lg border border-border/70 bg-secondary/20 p-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-primary/30 text-primary">
                        {row.action_type}
                      </Badge>
                      {row.action_outcome && (
                        <Badge variant="outline" className={auditOutcomeClass(row.action_outcome)}>
                          {row.action_outcome}
                        </Badge>
                      )}
                      {row.error_code && (
                        <Badge variant="outline" className={statusClasses.incident}>
                          {row.error_code}
                        </Badge>
                      )}
                      <span className="text-sm font-medium text-foreground">{row.target_type}</span>
                      {row.target_id && <span className="text-xs text-muted-foreground">{row.target_id}</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <LockKeyhole className="h-3.5 w-3.5" />
                      {row.admin_name || row.admin_id || "unknown admin"}
                    </div>
                    {(row.request_id || row.correlation_id) && (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {row.request_id && <span title={row.request_id}>request {shortenId(row.request_id)}</span>}
                        {row.correlation_id && <span title={row.correlation_id}>correlation {shortenId(row.correlation_id)}</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatRelativeTime(row.created_at)}
                  </div>
                </div>
                {row.details && (
                  <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-background/70 p-3 text-xs text-muted-foreground">
                    {JSON.stringify(row.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <LockKeyhole className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Admin Permissions</h3>
        </div>
        {permissions ? (
          <>
            <div className="flex flex-wrap gap-2">
              {asArray<string>(permissions.roles).map((role) => (
                <Badge key={role} variant="outline" className="border-border">
                  role: {role}
                </Badge>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Object.entries(permissionCatalogByArea).map(([area, items]) => (
                <div key={area} className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                  <div className="mb-2 text-sm font-medium text-foreground">{area}</div>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div key={item.permission} className="rounded-md border border-border/50 bg-background/40 p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-foreground">{item.permission}</span>
                          {item.is_break_glass && (
                            <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-300">
                              break-glass
                            </Badge>
                          )}
                        </div>
                        {item.label && <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {Object.keys(permissionCatalogByArea).length === 0 && (
              <div className="mt-3 rounded-lg border border-border/70 bg-secondary/20 p-4 text-sm text-muted-foreground">
                No granted admin permissions are visible for this session.
              </div>
            )}
            <div className="mt-3 text-xs text-muted-foreground">
              {permissions.permission_model}
            </div>
          </>
        ) : (
          <div className="mt-3">
            {unavailableSection("Admin permissions", "admin_get_admin_permissions", operationFailures)}
          </div>
        )}
      </section>
    </motion.div>
  );
};

export default AdminOperationsCenter;
