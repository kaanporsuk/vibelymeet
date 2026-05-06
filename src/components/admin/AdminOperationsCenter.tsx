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
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";

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
  created_at: string;
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
  rebuild_rehearsal_count?: number;
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
  permission_model?: string;
};

type AuditPayload = AdminRpcPayload & {
  rows?: AuditRow[];
  total_count?: number;
  limit?: number;
  offset?: number;
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

const factRows = (value: Record<string, unknown> | undefined) =>
  Object.entries(value || {}).map(([key, entry]) => (
    <div key={key} className="flex items-start justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{key.replace(/_/g, " ")}</span>
      <span className="text-right font-medium text-foreground">
        {typeof entry === "object" && entry !== null ? JSON.stringify(entry) : String(entry)}
      </span>
    </div>
  ));

const AdminOperationsCenter = () => {
  const [auditAction, setAuditAction] = useState("");
  const [auditTargetType, setAuditTargetType] = useState("");

  const opsQuery = useQuery({
    queryKey: ["admin-operations-center"],
    queryFn: async () => {
      const [system, providers, rebuild, incidents, permissions] = await Promise.all([
        callAdminRpc<SystemHealthPayload>("admin_get_system_health", {}),
        callAdminRpc<ProviderHealthPayload>("admin_get_provider_health", {}),
        callAdminRpc<RebuildStatusPayload>("admin_get_rebuild_status", {}),
        callAdminRpc<IncidentSignalsPayload>("admin_get_incident_signals", {}),
        callAdminRpc<PermissionsPayload>("admin_get_admin_permissions", {}),
      ]);

      return { system, providers, rebuild, incidents, permissions };
    },
    refetchInterval: 60000,
  });

  const auditQuery = useQuery({
    queryKey: ["admin-operations-audit", auditAction, auditTargetType],
    queryFn: async () =>
      callAdminRpc<AuditPayload>("admin_search_admin_audit_logs", {
        p_action_type: auditAction.trim() || null,
        p_target_type: auditTargetType.trim() || null,
        p_target_id: null,
        p_actor_id: null,
        p_from: null,
        p_to: null,
        p_limit: 25,
        p_offset: 0,
      }),
  });

  const overallStatus = useMemo(() => {
    const statuses = [
      opsQuery.data?.system.overall_status,
      opsQuery.data?.providers.overall_status,
      opsQuery.data?.rebuild.status,
      opsQuery.data?.incidents.status,
    ];
    return statuses.sort((a, b) => statusRank(b) - statusRank(a))[0] || "unknown";
  }, [opsQuery.data]);

  const healthAreas = asArray<HealthArea>(opsQuery.data?.system.health_areas);
  const providerChecks = asArray<ProviderCheck>(opsQuery.data?.providers.providers);
  const incidentSignals = asArray<IncidentSignal>(opsQuery.data?.incidents.signals);
  const auditRows = asArray<AuditRow>(auditQuery.data?.rows);

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

  if (opsQuery.isError) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
        Unable to read operations health from the backend admin RPCs. This is a read failure, not proof that production is healthy.
      </div>
    );
  }

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
              {opsQuery.data?.system.reporting_timezone || "UTC"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                opsQuery.refetch();
                auditQuery.refetch();
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {healthAreas.map((area) => (
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
        ))}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Provider Reconciliation</h3>
          </div>
          {statusBadge(opsQuery.data?.providers.overall_status)}
        </div>
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
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">Incident Signals</h3>
            </div>
            {statusBadge(opsQuery.data?.incidents.status)}
          </div>
          {incidentSignals.length === 0 ? (
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
            {statusBadge(opsQuery.data?.rebuild.status)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
              <div className="text-xs text-muted-foreground">Migrations</div>
              <div className="text-xl font-semibold text-foreground">{formatCount(opsQuery.data?.rebuild.migration_count)}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
              <div className="text-xs text-muted-foreground">Unclassified</div>
              <div className="text-xl font-semibold text-foreground">{formatCount(opsQuery.data?.rebuild.unclassified_migrations)}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
              <div className="text-xs text-muted-foreground">Classified</div>
              <div className="text-xl font-semibold text-foreground">{formatCount(opsQuery.data?.rebuild.classified_migrations)}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
              <div className="text-xs text-muted-foreground">Rehearsals</div>
              <div className="text-xl font-semibold text-foreground">{formatCount(opsQuery.data?.rebuild.rebuild_rehearsal_count)}</div>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-xs text-muted-foreground">
            <div>Latest migration: <span className="text-foreground">{opsQuery.data?.rebuild.latest_migration || "unknown"}</span></div>
            <div>Expected functions: {asArray<string>(opsQuery.data?.rebuild.expected_functions).join(", ") || "unknown"}</div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Admin Audit Explorer</h3>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={auditAction}
                onChange={(event) => setAuditAction(event.target.value)}
                aria-label="Filter audit logs by action type"
                placeholder="action type"
                className="w-full pl-8 sm:w-48"
              />
            </div>
            <Input
              value={auditTargetType}
              onChange={(event) => setAuditTargetType(event.target.value)}
              aria-label="Filter audit logs by target type"
              placeholder="target type"
              className="w-full sm:w-40"
            />
          </div>
        </div>
        {auditQuery.isError ? (
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
                      <span className="text-sm font-medium text-foreground">{row.target_type}</span>
                      {row.target_id && <span className="text-xs text-muted-foreground">{row.target_id}</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <LockKeyhole className="h-3.5 w-3.5" />
                      {row.admin_name || row.admin_id || "unknown admin"}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.created_at ? formatDistanceToNow(new Date(row.created_at), { addSuffix: true }) : "unknown time"}
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
        <div className="flex flex-wrap gap-2">
          {asArray<string>(opsQuery.data?.permissions.roles).map((role) => (
            <Badge key={role} variant="outline" className="border-border">
              role: {role}
            </Badge>
          ))}
          {asArray<string>(opsQuery.data?.permissions.permissions).slice(0, 12).map((permission) => (
            <Badge key={permission} className="bg-secondary text-secondary-foreground border-border">
              {permission}
            </Badge>
          ))}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          {opsQuery.data?.permissions.permission_model}
        </div>
      </section>
    </motion.div>
  );
};

export default AdminOperationsCenter;
