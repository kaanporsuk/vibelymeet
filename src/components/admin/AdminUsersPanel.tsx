import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ChevronDown,
  ChevronUp,
  MapPin,
  Calendar,
  Heart,
  Eye,
  ArrowUpDown,
  ShieldCheck,
  ShieldX,
  Crown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import {
  getRelationshipIntentAliases,
  getRelationshipIntentDisplaySafe,
  type RelationshipIntentId,
} from "@shared/profileContracts";
import AdminUserDetailDrawer from "./AdminUserDetailDrawer";
import { avatarUrl as avatarPreset } from "@/utils/imageUrl";
import { resolvePrimaryProfilePhotoPath } from "../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath";
import { callAdminRpc, type AdminRpcPayload } from "@/lib/adminRpc";

type SortField = 'name' | 'created_at' | 'age' | 'location' | 'total_matches' | 'event_registrations';
type SortDirection = 'asc' | 'desc';
type GenderBucket = 'all' | 'man' | 'woman' | 'non-binary' | 'other';
type LifecycleFilter = 'all' | 'complete' | 'incomplete' | 'bootstrap_fresh' | 'suspended';
type LifecycleStatus = 'complete' | 'incomplete' | 'incomplete_active' | 'bootstrap_fresh' | 'suspended';
const USERS_PAGE_SIZE = 50;

type AdminUserVibe = {
  label: string;
  emoji: string | null;
};

type AdminUserRow = {
  id: string;
  name: string | null;
  age: number | null;
  gender: string | null;
  birth_date: string | null;
  location: string | null;
  height_cm: number | null;
  looking_for: string | null;
  relationship_intent: string | null;
  avatar_url: string | null;
  photos: string[] | null;
  email_verified: boolean | null;
  photo_verified: boolean | null;
  is_premium: boolean | null;
  is_suspended: boolean | null;
  created_at: string;
  updated_at: string | null;
  onboarding_complete: boolean | null;
  onboarding_stage: string | null;
  last_seen_at: string | null;
  is_bootstrap_fresh: boolean;
  has_activity: boolean;
  lifecycle_status: LifecycleStatus | string | null;
  age_is_placeholder: boolean;
  total_matches: number | null;
  event_registrations: number;
  confirmed_attendance?: number;
  vibes?: AdminUserVibe[];
};

type AdminSearchUsersPayload = AdminRpcPayload & {
  rows?: AdminUserRow[];
  total_count?: number;
  registration_semantics?: string;
  filter_semantics?: string;
};

const MAN_GENDER_VALUES = ['man', 'male'] as const;
const WOMAN_GENDER_VALUES = ['woman', 'female'] as const;
const NON_BINARY_GENDER_VALUES = ['non-binary', 'non_binary'] as const;

const getGenderBucket = (gender?: string | null): Exclude<GenderBucket, 'all'> => {
  const value = gender?.trim().toLowerCase();
  if (!value) return 'other';
  if (MAN_GENDER_VALUES.includes(value as (typeof MAN_GENDER_VALUES)[number])) return 'man';
  if (WOMAN_GENDER_VALUES.includes(value as (typeof WOMAN_GENDER_VALUES)[number])) return 'woman';
  if (NON_BINARY_GENDER_VALUES.includes(value as (typeof NON_BINARY_GENDER_VALUES)[number])) return 'non-binary';
  return 'other';
};

const getGenderBadgeLabel = (gender?: string | null): string => {
  const bucket = getGenderBucket(gender);
  if (bucket === 'man') return 'Man';
  if (bucket === 'woman') return 'Woman';
  if (bucket === 'non-binary') return 'Non-binary';
  return 'Other';
};

const getGenderBadgeClassName = (gender?: string | null): string => {
  const bucket = getGenderBucket(gender);
  if (bucket === 'man') return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
  if (bucket === 'woman') return 'bg-pink-500/10 text-pink-400 border-pink-500/30';
  if (bucket === 'non-binary') return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
  return 'bg-slate-500/10 text-slate-300 border-slate-500/30';
};

const isBootstrapDefaultGender = (user: Pick<AdminUserRow, 'gender' | 'onboarding_complete' | 'is_bootstrap_fresh'>): boolean => {
  const value = user.gender?.trim().toLowerCase();
  return (
    !user.onboarding_complete &&
    (user.is_bootstrap_fresh || !value || value === 'prefer_not_to_say' || value === 'prefer not to say')
  );
};

const getUserGenderBadgeLabel = (user: AdminUserRow): string => (
  isBootstrapDefaultGender(user) ? 'Pending' : getGenderBadgeLabel(user.gender)
);

const getUserGenderBadgeClassName = (user: AdminUserRow): string => (
  isBootstrapDefaultGender(user)
    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
    : getGenderBadgeClassName(user.gender)
);

const getLifecycleBadgeMeta = (status?: string | null) => {
  if (status === 'complete') {
    return { label: 'Complete', className: 'bg-green-500/10 text-green-400 border-green-500/30' };
  }
  if (status === 'bootstrap_fresh') {
    return { label: 'Bootstrap fresh', className: 'bg-amber-500/10 text-amber-300 border-amber-500/30' };
  }
  if (status === 'incomplete_active') {
    return { label: 'Incomplete active', className: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' };
  }
  if (status === 'suspended') {
    return { label: 'Suspended', className: 'bg-red-500/10 text-red-400 border-red-500/30' };
  }
  return { label: 'Incomplete', className: 'bg-slate-500/10 text-slate-300 border-slate-500/30' };
};

const getPendingAwareEmptyLabel = (user: AdminUserRow): string => (
  user.lifecycle_status === 'bootstrap_fresh' || user.is_bootstrap_fresh ? 'Pending' : 'N/A'
);

const getServerSort = (field: SortField, direction: SortDirection): string => {
  if (field === 'event_registrations') return `registrations_${direction}`;
  return `${field}_${direction}`;
};

const AdminUsersPanel = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [genderFilter, setGenderFilter] = useState<GenderBucket>("all");
  const [verificationFilter, setVerificationFilter] = useState<string>("all");
  const [lookingForFilter, setLookingForFilter] = useState<string>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("all");
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Fetch users through the backend admin aggregate so counts and filters are server-owned.
  const { data: usersPayload, isLoading, isError: usersError } = useQuery({
    queryKey: ['admin-users', searchQuery, genderFilter, verificationFilter, lookingForFilter, lifecycleFilter, sortField, sortDirection, pageIndex],
    queryFn: async () => {
      const filters: Record<string, unknown> = {};
      if (genderFilter !== 'all') filters.gender_bucket = genderFilter;
      if (verificationFilter === 'verified') {
        filters.photo_verified = true;
      } else if (verificationFilter === 'unverified') {
        filters.photo_verified = false;
      } else if (verificationFilter === 'suspended') {
        filters.is_suspended = true;
      }
      if (lookingForFilter !== 'all') {
        filters.relationship_intents = getRelationshipIntentAliases(lookingForFilter as RelationshipIntentId);
      }
      if (lifecycleFilter !== 'all') {
        filters.lifecycle_status = lifecycleFilter;
      }

      return callAdminRpc<AdminSearchUsersPayload>("admin_search_users", {
        p_search: searchQuery.trim() || null,
        p_filters: filters,
        p_sort: getServerSort(sortField, sortDirection),
        p_limit: USERS_PAGE_SIZE,
        p_offset: pageIndex * USERS_PAGE_SIZE,
      });
    },
  });

  const users = useMemo(() => usersPayload?.rows ?? [], [usersPayload?.rows]);
  const totalCount = Number(usersPayload?.total_count ?? users.length);
  const totalPages = Math.max(1, Math.ceil(totalCount / USERS_PAGE_SIZE));
  const firstVisibleUser = totalCount === 0 ? 0 : pageIndex * USERS_PAGE_SIZE + 1;
  const lastVisibleUser = Math.min(totalCount, pageIndex * USERS_PAGE_SIZE + users.length);
  const canGoPrevious = pageIndex > 0;
  const canGoNext = pageIndex + 1 < totalPages;

  const refreshedAvatars = useMemo(() => {
    const resolved: Record<string, string> = {};
    for (const user of users) {
      const raw = resolvePrimaryProfilePhotoPath({
        photos: user.photos,
        avatar_url: user.avatar_url,
      });
      if (raw) resolved[user.id] = avatarPreset(raw);
    }
    return resolved;
  }, [users]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setPageIndex(0);
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-4 h-4 text-muted-foreground" />;
    return sortDirection === 'asc' ?
      <ChevronUp className="w-4 h-4 text-primary" /> :
      <ChevronDown className="w-4 h-4 text-primary" />;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Filters */}
      <div className="glass-card p-4 rounded-2xl">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:flex-wrap gap-4">
            <div className="flex-1 min-w-[240px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Search by name or location..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPageIndex(0);
                }}
                className="pl-11 bg-secondary/50"
              />
            </div>
            <Select
              value={genderFilter}
              onValueChange={(value) => {
                setGenderFilter(value as GenderBucket);
                setPageIndex(0);
              }}
            >
              <SelectTrigger className="w-full md:w-[150px] bg-secondary/50">
                <SelectValue placeholder="Gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Genders</SelectItem>
                <SelectItem value="man">Man</SelectItem>
                <SelectItem value="woman">Woman</SelectItem>
                <SelectItem value="non-binary">Non-binary</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={verificationFilter}
              onValueChange={(value) => {
                setVerificationFilter(value);
                setPageIndex(0);
              }}
            >
              <SelectTrigger className="w-full md:w-[150px] bg-secondary/50">
                <SelectValue placeholder="Verification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="verified">Verified</SelectItem>
                <SelectItem value="unverified">Unverified</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={lookingForFilter}
              onValueChange={(value) => {
                setLookingForFilter(value);
                setPageIndex(0);
              }}
            >
              <SelectTrigger className="w-full md:w-[150px] bg-secondary/50">
                <SelectValue placeholder="Looking For" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Intents</SelectItem>
                <SelectItem value="long-term">Long-term</SelectItem>
                <SelectItem value="relationship">Relationship</SelectItem>
                <SelectItem value="something-casual">Casual</SelectItem>
                <SelectItem value="new-friends">New friends</SelectItem>
                <SelectItem value="figuring-out">Figuring out</SelectItem>
                <SelectItem value="rather-not">Rather not say</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={lifecycleFilter}
              onValueChange={(value) => {
                setLifecycleFilter(value as LifecycleFilter);
                setPageIndex(0);
              }}
            >
              <SelectTrigger className="w-full md:w-[170px] bg-secondary/50">
                <SelectValue placeholder="Lifecycle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Lifecycle</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="incomplete">Incomplete</SelectItem>
                <SelectItem value="bootstrap_fresh">Bootstrap fresh</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                Showing {firstVisibleUser}-{lastVisibleUser} of {totalCount} users
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Page {pageIndex + 1} of {totalPages}. Event registration counts are derived server-side from registration rows; they are not confirmed attendance.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canGoPrevious || isLoading}
                onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canGoNext || isLoading}
                onClick={() => setPageIndex((page) => page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="w-[250px]">
                  <button
                    onClick={() => handleSort('name')}
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                  >
                    User
                    {getSortIcon('name')}
                  </button>
                </TableHead>
                <TableHead>Gender</TableHead>
                <TableHead>
                  <button
                    onClick={() => handleSort('age')}
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                  >
                    Age
                    {getSortIcon('age')}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    onClick={() => handleSort('location')}
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                  >
                    Location
                    {getSortIcon('location')}
                  </button>
                </TableHead>
                <TableHead>Height</TableHead>
                <TableHead>Looking For</TableHead>
                <TableHead>Vibes</TableHead>
                <TableHead>
                  <button
                    onClick={() => handleSort('total_matches')}
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                  >
                    Matches
                    {getSortIcon('total_matches')}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    onClick={() => handleSort('event_registrations')}
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                  >
                    Event registrations
                    {getSortIcon('event_registrations')}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    onClick={() => handleSort('created_at')}
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                  >
                    Joined
                    {getSortIcon('created_at')}
                  </button>
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    <TableCell colSpan={11}>
                      <div className="h-12 bg-secondary/50 rounded animate-pulse" />
                    </TableCell>
                  </TableRow>
                ))
              ) : usersError ? (
                <TableRow className="border-border/50">
                  <TableCell colSpan={11} className="text-center py-8 text-destructive">
                    Could not load users or derived event registration counts.
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow className="border-border/50">
                  <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => {
                  const relationshipIntent = user.relationship_intent || user.looking_for;
                  const relationshipDisplay = relationshipIntent
                    ? getRelationshipIntentDisplaySafe(relationshipIntent)
                    : null;
                  const vibesUnavailable = !Array.isArray(user.vibes);
                  const vibesForUser = Array.isArray(user.vibes) ? user.vibes : [];
                  const lifecycle = getLifecycleBadgeMeta(user.lifecycle_status);
                  const emptyProfileLabel = getPendingAwareEmptyLabel(user);

                  return (
                  <TableRow
                    key={user.id}
                    className="border-border/50 hover:bg-secondary/30 cursor-pointer"
                    onClick={() => setSelectedUserId(user.id)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 border-2 border-border">
                          <AvatarImage
                            src={
                              refreshedAvatars[user.id] ||
                              avatarPreset(
                                resolvePrimaryProfilePhotoPath({
                                  photos: user.photos,
                                  avatar_url: user.avatar_url,
                                }),
                              )
                            }
                          />
                          <AvatarFallback className="bg-primary/20 text-primary">
                            {user.name?.[0]?.toUpperCase() || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-foreground flex items-center gap-2">
                            {user.name || 'Unnamed user'}
                            {user.is_premium && (
                              <Crown className="w-4 h-4 text-primary shrink-0" />
                            )}
                            {user.photo_verified && (
                              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">
                                <ShieldCheck className="w-3 h-3 mr-1" />
                                Verified
                              </Badge>
                            )}
                            {user.is_suspended && (
                              <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30">
                                <ShieldX className="w-3 h-3 mr-1" />
                                Suspended
                              </Badge>
                            )}
                          </p>
                          <Badge variant="outline" className={`mt-1 text-xs ${lifecycle.className}`}>
                            {lifecycle.label}
                          </Badge>
                          <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {user.id.slice(0, 8)}...
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={getUserGenderBadgeClassName(user)}
                      >
                        {getUserGenderBadgeLabel(user)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.age_is_placeholder ? (
                        <span className="text-sm text-muted-foreground">Pending</span>
                      ) : (
                        user.age ?? 'N/A'
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <MapPin className="w-3 h-3 text-muted-foreground" />
                        <span className="truncate max-w-[100px]">{user.location || emptyProfileLabel}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.height_cm ? `${user.height_cm}cm` : emptyProfileLabel}
                    </TableCell>
                    <TableCell>
                      <span className="truncate max-w-[80px] text-sm">
                        {relationshipDisplay
                          ? `${relationshipDisplay.emoji} ${relationshipDisplay.label}`
                          : emptyProfileLabel}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[120px]">
                        {vibesUnavailable ? (
                          <span className="text-xs text-muted-foreground">Vibes unavailable</span>
                        ) : vibesForUser.slice(0, 2).map((vibe, i) => (
                          <span key={i} className="text-xs">
                            {vibe.emoji}
                          </span>
                        ))}
                        {vibesForUser.length > 2 && (
                          <span className="text-xs text-muted-foreground">
                            +{vibesForUser.length - 2}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Heart className="w-3 h-3 text-pink-400" />
                        <span>{user.total_matches || 0}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-orange-400" />
                        <span>{user.event_registrations || 0}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(user.created_at), 'MMM d, yyyy')}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedUserId(user.id);
                        }}
                        className="gap-2"
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* User Detail Drawer */}
      <AnimatePresence>
        {selectedUserId && (
          <AdminUserDetailDrawer
            userId={selectedUserId}
            onClose={() => setSelectedUserId(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default AdminUsersPanel;
