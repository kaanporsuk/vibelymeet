import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Flag, RefreshCw, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";
import { formatAdminUtcDateTime } from "@/lib/adminTime";
import { adminToast } from "@/lib/adminToast";

type ClientFeatureFlagRow = {
  flag_key: string;
  enabled: boolean;
  kill_switch_active: boolean;
  rollout_bps: number;
  description: string | null;
  updated_by: string | null;
  updated_at: string | null;
  override_count: number;
};

type ClientFeatureFlagOverrideRow = {
  flag_key: string;
  user_id: string;
  enabled: boolean;
  reason: string | null;
  updated_by: string | null;
  updated_at: string | null;
  user_name: string | null;
  user_email: string | null;
};

type AdminFlagListPayload = AdminRpcPayload & {
  rows?: ClientFeatureFlagRow[];
};

type AdminOverrideListPayload = AdminRpcPayload & {
  rows?: ClientFeatureFlagOverrideRow[];
};

type AdminUserSearchRow = {
  id: string;
  name: string | null;
  location?: string | null;
  lifecycle_status?: string | null;
};

type AdminSearchUsersPayload = AdminRpcPayload & {
  rows?: AdminUserSearchRow[];
};

function formatUpdatedAt(value: string | null | undefined): string {
  return formatAdminUtcDateTime(value);
}

const AdminClientFeatureFlagsPanel = () => {
  const queryClient = useQueryClient();
  const [selectedFlagKey, setSelectedFlagKey] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [rolloutBps, setRolloutBps] = useState(0);
  const [description, setDescription] = useState("");
  const [mutationReason, setMutationReason] = useState("");
  const [overrideSearch, setOverrideSearch] = useState("");
  const [overrideUserId, setOverrideUserId] = useState("");
  const [overrideEnabled, setOverrideEnabled] = useState(true);
  const [overrideReason, setOverrideReason] = useState("");

  const flagsQuery = useQuery({
    queryKey: ["admin-client-feature-flags"],
    queryFn: () => callAdminRpc<AdminFlagListPayload>("admin_list_client_feature_flags", {}),
  });

  const flags = useMemo(() => flagsQuery.data?.rows ?? [], [flagsQuery.data?.rows]);
  const selectedFlag = flags.find((flag) => flag.flag_key === selectedFlagKey) ?? flags[0] ?? null;

  useEffect(() => {
    if (!selectedFlag) return;
    setSelectedFlagKey(selectedFlag.flag_key);
    setEnabled(selectedFlag.enabled);
    setKillSwitchActive(selectedFlag.kill_switch_active);
    setRolloutBps(selectedFlag.rollout_bps);
    setDescription(selectedFlag.description ?? "");
    setMutationReason("");
    setOverrideReason("");
  }, [selectedFlag]);

  const overridesQuery = useQuery({
    queryKey: ["admin-client-feature-flag-overrides", selectedFlag?.flag_key, overrideSearch],
    enabled: !!selectedFlag,
    queryFn: () =>
      callAdminRpc<AdminOverrideListPayload>("admin_list_client_feature_flag_overrides", {
        p_flag: selectedFlag!.flag_key,
        p_search: overrideSearch.trim() || null,
        p_limit: 100,
      }),
  });

  const userSearchQuery = useQuery({
    queryKey: ["admin-client-feature-flag-user-search", overrideSearch],
    enabled: overrideSearch.trim().length >= 2,
    queryFn: () =>
      callAdminRpc<AdminSearchUsersPayload>("admin_search_users", {
        p_search: overrideSearch.trim(),
        p_filters: {},
        p_sort: "created_at_desc",
        p_limit: 5,
        p_offset: 0,
      }),
  });

  const invalidatePanel = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-client-feature-flags"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-client-feature-flag-overrides"] }),
    ]);

  const updateFlagMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFlag) throw new Error("Select a flag first.");
      if (!mutationReason.trim()) throw new Error("A reason is required.");
      return callAdminRpc("admin_update_client_feature_flag", {
        p_flag: selectedFlag.flag_key,
        p_enabled: enabled,
        p_rollout_bps: rolloutBps,
        p_kill_switch_active: killSwitchActive,
        p_description: description.trim(),
        p_reason: mutationReason.trim(),
      });
    },
    onSuccess: async () => {
      adminToast.success({
        id: selectedFlag ? `client-feature-flag-updated-${selectedFlag.flag_key}` : "client-feature-flag-updated",
        title: "Feature flag updated",
      });
      await invalidatePanel();
    },
    onError: (error) => adminToast.error({
      id: selectedFlag ? `client-feature-flag-update-failed-${selectedFlag.flag_key}` : "client-feature-flag-update-failed",
      title: error instanceof Error ? error.message : "Could not update feature flag",
    }),
  });

  const upsertOverrideMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFlag) throw new Error("Select a flag first.");
      if (!overrideUserId.trim()) throw new Error("User ID is required.");
      if (!overrideReason.trim()) throw new Error("A reason is required.");
      return callAdminRpc("admin_upsert_client_feature_flag_override", {
        p_flag: selectedFlag.flag_key,
        p_user_id: overrideUserId.trim(),
        p_enabled: overrideEnabled,
        p_reason: overrideReason.trim(),
      });
    },
    onSuccess: async () => {
      adminToast.success({
        id: selectedFlag ? `client-feature-flag-override-saved-${selectedFlag.flag_key}` : "client-feature-flag-override-saved",
        title: "Override saved",
      });
      setOverrideUserId("");
      setOverrideReason("");
      await invalidatePanel();
    },
    onError: (error) => adminToast.error({
      id: selectedFlag ? `client-feature-flag-override-save-failed-${selectedFlag.flag_key}` : "client-feature-flag-override-save-failed",
      title: error instanceof Error ? error.message : "Could not save override",
    }),
  });

  const deleteOverrideMutation = useMutation({
    mutationFn: async (row: ClientFeatureFlagOverrideRow) => {
      if (!overrideReason.trim()) throw new Error("Enter a reason before removing an override.");
      return callAdminRpc("admin_delete_client_feature_flag_override", {
        p_flag: row.flag_key,
        p_user_id: row.user_id,
        p_reason: overrideReason.trim(),
      });
    },
    onSuccess: async () => {
      adminToast.success({
        id: selectedFlag ? `client-feature-flag-override-removed-${selectedFlag.flag_key}` : "client-feature-flag-override-removed",
        title: "Override removed",
      });
      setOverrideReason("");
      await invalidatePanel();
    },
    onError: (error) => adminToast.error({
      id: selectedFlag ? `client-feature-flag-override-remove-failed-${selectedFlag.flag_key}` : "client-feature-flag-override-remove-failed",
      title: error instanceof Error ? error.message : "Could not remove override",
    }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border/60 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Client Feature Flags</h2>
          <p className="text-sm text-muted-foreground">
            Manage media-v2 rollout, emergency hard kills, and staff/user overrides.
          </p>
        </div>
        <Button variant="outline" onClick={() => void invalidatePanel()} disabled={flagsQuery.isFetching}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="space-y-3">
          {flags.map((flag) => (
            <button
              key={flag.flag_key}
              type="button"
              onClick={() => setSelectedFlagKey(flag.flag_key)}
              className={`w-full rounded-lg border p-4 text-left transition ${
                selectedFlag?.flag_key === flag.flag_key
                  ? "border-primary/50 bg-primary/10"
                  : "border-border/60 bg-card/50 hover:bg-secondary/40"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Flag className="h-4 w-4 text-primary" />
                  <span className="font-mono text-sm font-semibold">{flag.flag_key}</span>
                </div>
                {flag.kill_switch_active ? (
                  <Badge variant="destructive">Killed</Badge>
                ) : flag.enabled ? (
                  <Badge variant="outline">{Math.round(flag.rollout_bps / 100)}%</Badge>
                ) : (
                  <Badge variant="secondary">Off</Badge>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{flag.description || "No description"}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {flag.override_count} overrides · Updated {formatUpdatedAt(flag.updated_at)}
              </p>
            </button>
          ))}
          {!flagsQuery.isLoading && flags.length === 0 ? (
            <div className="rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
              No client feature flags are configured.
            </div>
          ) : null}
        </div>

        {selectedFlag ? (
          <div className="space-y-6">
            <section className="rounded-lg border border-border/60 bg-card/40 p-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-mono text-lg font-semibold">{selectedFlag.flag_key}</h3>
                  <p className="text-sm text-muted-foreground">Global controls apply before per-user overrides.</p>
                </div>
                {killSwitchActive || !enabled ? (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Hard kill
                  </Badge>
                ) : null}
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Enabled</Label>
                  <div className="flex items-center gap-3 rounded-md border border-border/60 p-3">
                    <Switch checked={enabled} onCheckedChange={setEnabled} />
                    <span className="text-sm text-muted-foreground">Allow overrides and rollout when on</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Kill switch</Label>
                  <div className="flex items-center gap-3 rounded-md border border-border/60 p-3">
                    <Switch checked={killSwitchActive} onCheckedChange={setKillSwitchActive} />
                    <span className="text-sm text-muted-foreground">Force everyone to legacy immediately</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="rollout-bps">Rollout</Label>
                  <span className="font-mono text-sm">{rolloutBps} bps · {Math.round(rolloutBps / 100)}%</span>
                </div>
                <input
                  id="rollout-bps"
                  type="range"
                  min={0}
                  max={10000}
                  step={100}
                  value={rolloutBps}
                  onChange={(event) => setRolloutBps(Number(event.target.value))}
                  className="w-full"
                />
              </div>

              <div className="mt-5 space-y-2">
                <Label htmlFor="flag-description">Description</Label>
                <Textarea
                  id="flag-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                />
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
                <Input
                  value={mutationReason}
                  onChange={(event) => setMutationReason(event.target.value)}
                  placeholder="Reason required for audit trail"
                />
                <Button onClick={() => updateFlagMutation.mutate()} disabled={updateFlagMutation.isPending}>
                  Save flag
                </Button>
              </div>
            </section>

            <section className="rounded-lg border border-border/60 bg-card/40 p-5">
              <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Overrides</h3>
                  <p className="text-sm text-muted-foreground">Use for staff testing with enabled=true and rollout=0.</p>
                </div>
                <div className="relative md:w-72">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    value={overrideSearch}
                    onChange={(event) => setOverrideSearch(event.target.value)}
                    placeholder="Search users or overrides"
                  />
                </div>
              </div>

              {userSearchQuery.data?.rows?.length ? (
                <div className="mb-4 grid gap-2">
                  {userSearchQuery.data.rows.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => setOverrideUserId(user.id)}
                      className="rounded-md border border-border/60 px-3 py-2 text-left text-sm hover:bg-secondary/40"
                    >
                      <span className="font-medium">{user.name || "Unnamed user"}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{user.id}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-[1fr_130px_1fr_auto]">
                <Input
                  value={overrideUserId}
                  onChange={(event) => setOverrideUserId(event.target.value)}
                  placeholder="User UUID"
                />
                <Button type="button" variant="outline" onClick={() => setOverrideEnabled((value) => !value)}>
                  {overrideEnabled ? "Force On" : "Force Off"}
                </Button>
                <Input
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  placeholder="Reason required"
                />
                <Button onClick={() => upsertOverrideMutation.mutate()} disabled={upsertOverrideMutation.isPending}>
                  Save override
                </Button>
              </div>

              <div className="mt-5 divide-y divide-border/60 rounded-lg border border-border/60">
                {(overridesQuery.data?.rows ?? []).map((row) => (
                  <div key={`${row.flag_key}:${row.user_id}`} className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{row.user_name || row.user_email || "User override"}</span>
                        <Badge variant={row.enabled ? "default" : "secondary"}>{row.enabled ? "On" : "Off"}</Badge>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{row.user_id}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.reason || "No reason"} · Updated {formatUpdatedAt(row.updated_at)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setOverrideUserId(row.user_id);
                        setOverrideEnabled(!row.enabled);
                      }}
                    >
                      Flip
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteOverrideMutation.mutate(row)}
                      disabled={deleteOverrideMutation.isPending}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                ))}
                {!overridesQuery.isLoading && (overridesQuery.data?.rows ?? []).length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">No overrides for this flag.</div>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AdminClientFeatureFlagsPanel;
