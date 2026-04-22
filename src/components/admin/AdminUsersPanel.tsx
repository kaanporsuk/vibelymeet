import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  User,
  Mail,
  MapPin,
  Calendar,
  Heart,
  Eye,
  X,
  ArrowUpDown,
  Ruler,
  Sparkles,
  ShieldCheck,
  ShieldX,
  Download,
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
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { getRelationshipIntentAliases, getRelationshipIntentDisplaySafe } from "@shared/profileContracts";
import AdminUserDetailDrawer from "./AdminUserDetailDrawer";
import { avatarUrl as avatarPreset } from "@/utils/imageUrl";
import { resolvePrimaryProfilePhotoPath } from "../../../shared/profilePhoto/resolvePrimaryProfilePhotoPath";

type SortField = 'name' | 'created_at' | 'age' | 'location' | 'total_matches' | 'events_attended';
type SortDirection = 'asc' | 'desc';
type GenderBucket = 'all' | 'man' | 'woman' | 'non-binary' | 'other';

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

const AdminUsersPanel = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [genderFilter, setGenderFilter] = useState<GenderBucket>("all");
  const [verificationFilter, setVerificationFilter] = useState<string>("all");
  const [lookingForFilter, setLookingForFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [refreshedAvatars, setRefreshedAvatars] = useState<Record<string, string>>({});

  // Fetch all users
  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users', searchQuery, genderFilter, verificationFilter, lookingForFilter, sortField, sortDirection],
    queryFn: async () => {
      let query = supabase
        .from('profiles')
        .select(`
          id,
          name,
          age,
          gender,
          birth_date,
          location,
          height_cm,
          looking_for,
          relationship_intent,
          avatar_url,
          photos,
          
          email_verified,
          photo_verified,
          is_suspended,
          created_at,
          updated_at,
          total_matches,
          events_attended
        `)
        .order(sortField, { ascending: sortDirection === 'asc' });

      if (genderFilter === 'man') {
        query = query.in('gender', [...MAN_GENDER_VALUES]);
      } else if (genderFilter === 'woman') {
        query = query.in('gender', [...WOMAN_GENDER_VALUES]);
      } else if (genderFilter === 'non-binary') {
        query = query.in('gender', [...NON_BINARY_GENDER_VALUES]);
      }

      if (verificationFilter === 'verified') {
        query = query.eq('photo_verified', true);
      } else if (verificationFilter === 'unverified') {
        query = query.eq('photo_verified', false);
      } else if (verificationFilter === 'suspended') {
        query = query.eq('is_suspended', true);
      }

      if (lookingForFilter !== 'all') {
        const aliases = getRelationshipIntentAliases(lookingForFilter as any);
        const relOr = aliases.map((a) => `relationship_intent.eq.${a}`).join(',');
        const lfOr = aliases.map((a) => `looking_for.eq.${a}`).join(',');
        query = query.or(`${relOr},${lfOr}`);
      }

      if (searchQuery) {
        query = query.or(`name.ilike.%${searchQuery}%,location.ilike.%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];
      if (genderFilter === 'other') {
        // Keep this bucket local to avoid stacking multiple PostgREST `or(...)` clauses.
        return rows.filter((row) => getGenderBucket(row.gender) === 'other');
      }
      return rows;
    },
  });

  // Resolve avatar URLs via CDN helper (no async refresh needed)
  useEffect(() => {
    if (!users?.length) return;
    const resolved: Record<string, string> = {};
    for (const user of users) {
      const raw = resolvePrimaryProfilePhotoPath({
        photos: user.photos,
        avatar_url: user.avatar_url,
      });
      if (raw) resolved[user.id] = avatarPreset(raw);
    }
    setRefreshedAvatars(resolved);
  }, [users]);

  // Fetch vibes for all users
  const { data: userVibes } = useQuery({
    queryKey: ['admin-user-vibes'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profile_vibes')
        .select(`
          profile_id,
          vibe_tags (
            label,
            emoji
          )
        `);
      
      // Group by profile_id
      const grouped: Record<string, { label: string; emoji: string }[]> = {};
      data?.forEach((item) => {
        if (!grouped[item.profile_id]) {
          grouped[item.profile_id] = [];
        }
        if (item.vibe_tags) {
          const raw = item.vibe_tags as { label: string; emoji: string } | { label: string; emoji: string }[] | null;
          const tag = Array.isArray(raw) ? raw[0] : raw;
          if (tag?.label) {
            grouped[item.profile_id].push({ label: tag.label, emoji: tag.emoji ?? '' });
          }
        }
      });
      return grouped;
    },
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
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
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Search by name or location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-11 bg-secondary/50"
              />
            </div>
            <Select
              value={genderFilter}
              onValueChange={(value) => setGenderFilter(value as GenderBucket)}
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
            <Select value={verificationFilter} onValueChange={setVerificationFilter}>
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
            <Select value={lookingForFilter} onValueChange={setLookingForFilter}>
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
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {users?.length || 0} users found
            </p>
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
                    onClick={() => handleSort('events_attended')}
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                  >
                    Events
                    {getSortIcon('events_attended')}
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
                    <TableCell colSpan={10}>
                      <div className="h-12 bg-secondary/50 rounded animate-pulse" />
                    </TableCell>
                  </TableRow>
                ))
              ) : users?.length === 0 ? (
                <TableRow className="border-border/50">
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                users?.map((user) => (
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
                            {user.name}
                            {(user as any).is_premium && (
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
                          <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {user.id.slice(0, 8)}...
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="outline" 
                        className={getGenderBadgeClassName(user.gender)}
                      >
                        {getGenderBadgeLabel(user.gender)}
                      </Badge>
                    </TableCell>
                    <TableCell>{user.age}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <MapPin className="w-3 h-3 text-muted-foreground" />
                        <span className="truncate max-w-[100px]">{user.location || 'N/A'}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.height_cm ? `${user.height_cm}cm` : 'N/A'}
                    </TableCell>
                    <TableCell>
                      <span className="truncate max-w-[80px] text-sm">
                        {user.relationship_intent || user.looking_for
                          ? `${getRelationshipIntentDisplaySafe(user.relationship_intent || user.looking_for).emoji} ${getRelationshipIntentDisplaySafe(user.relationship_intent || user.looking_for).label}`
                          : 'N/A'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[120px]">
                        {userVibes?.[user.id]?.slice(0, 2).map((vibe, i) => (
                          <span key={i} className="text-xs">
                            {vibe.emoji}
                          </span>
                        ))}
                        {userVibes?.[user.id]?.length > 2 && (
                          <span className="text-xs text-muted-foreground">
                            +{userVibes[user.id].length - 2}
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
                        <span>{user.events_attended || 0}</span>
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
                ))
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