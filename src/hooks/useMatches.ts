import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";
import { getImageUrl, avatarUrl as avatarPreset } from "@/utils/imageUrl";
import {
  bestMatchSortKey,
  compatibilityPercent,
  type MatchScoreInput,
} from "@/utils/matchSortScore";
import { resolvePrimaryProfilePhotoPath } from "../../shared/profilePhoto/resolvePrimaryProfilePhotoPath";
import type { ConversationPreview } from "../../shared/chat/conversationListPreview";
import {
  conversationPreviewSearchText,
  getConversationPreview,
  getEmptyConversationPreview,
} from "../../shared/chat/conversationListPreview";
import { fetchUserProfiles, type UserProfileView } from "@/services/fetchUserProfile";

/** Canonical profile row shape used by match list scoring + display. */
type MatchesListProfileRow = {
  id: string;
  name: string | null;
  age: number | null;
  avatar_url: string | null;
  photos: string[] | null;
  photo_verified: boolean | null;
  about_me: string | null;
  job: string | null;
  location: string | null;
  height_cm: number | null;
  looking_for: string | null;
  relationship_intent: string | null;
  prompts: unknown;
  lifestyle: unknown;
  tagline: string | null;
  bunny_video_uid: string | null;
  vibe_video_playback_ref: string | null;
  vibes?: string[];
};

function profileIntentForMatch(
  p: Pick<MatchesListProfileRow, "relationship_intent" | "looking_for"> | undefined,
): string | null {
  return p?.relationship_intent ?? p?.looking_for ?? null;
}

/** Latest message row shape from matches list query (one row per match). */
type MatchLatestMessageRow = {
  match_id: string;
  content: string | null;
  created_at: string;
  read_at: string | null;
  sender_id: string;
  message_kind: string | null;
  audio_url: string | null;
  video_url: string | null;
  structured_payload: unknown;
};

type MatchRealtimeRow = {
  profile_id_1?: string | null;
  profile_id_2?: string | null;
};

type MatchEventRow = {
  id: string;
  title: string;
};

type MatchArchiveRow = {
  match_id: string;
  archived_at: string;
};

type DashboardVisibleMatchRow = {
  id: string;
  matched_at: string;
  profile_id_1: string;
  profile_id_2: string;
};

export type DashboardMatchPreview = {
  id: string;
  name: string;
  image: string;
  isNew: boolean;
};

const DASHBOARD_MATCH_SELECT = "id, matched_at, profile_id_1, profile_id_2";

function profileViewToMatchRow(profile: UserProfileView | null): MatchesListProfileRow | null {
  if (!profile?.id) return null;
  return {
    id: profile.id,
    name: profile.name,
    age: profile.age,
    avatar_url: profile.avatar_url,
    photos: profile.photos,
    photo_verified: profile.photo_verified,
    about_me: profile.about_me,
    job: profile.job,
    location: profile.display_location ?? profile.location,
    height_cm: profile.height_cm,
    looking_for: profile.looking_for,
    relationship_intent: profile.relationship_intent,
    prompts: profile.prompts,
    lifestyle: profile.lifestyle,
    tagline: profile.tagline,
    bunny_video_uid: profile.bunny_video_uid,
    vibe_video_playback_ref: profile.vibe_video_playback_ref ?? null,
    vibes: profile.vibes,
  };
}

async function fetchProfilesForViewer(profileIds: string[]): Promise<MatchesListProfileRow[]> {
  const uniqueIds = Array.from(new Set(profileIds.filter(Boolean)));
  const profiles = await fetchUserProfiles(uniqueIds);
  return profiles.map(profileViewToMatchRow).filter((profile): profile is MatchesListProfileRow => !!profile);
}

function isMissingDashboardRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  return code === "PGRST202" || code === "42883" || message.includes("get_dashboard_visible_matches");
}

async function fetchDashboardVisibleMatches(userId: string): Promise<DashboardVisibleMatchRow[]> {
  const { data: rpcMatches, error } = await supabase
    .rpc("get_dashboard_visible_matches", { p_limit: 5 });

  if (!error) return (rpcMatches ?? []) as DashboardVisibleMatchRow[];
  if (!isMissingDashboardRpc(error)) throw error;

  const pageSize = 20;
  const visibleMatches: DashboardVisibleMatchRow[] = [];
  let offset = 0;

  while (visibleMatches.length < 5) {
    const { data: matches, error: matchesError } = await supabase
      .from("matches")
      .select(DASHBOARD_MATCH_SELECT)
      .or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`)
      .order("matched_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (matchesError) throw matchesError;
    const matchRows = (matches ?? []) as DashboardVisibleMatchRow[];
    if (!matchRows.length) break;

    const { data: archives, error: archivesError } = await supabase
      .from("match_archives")
      .select("match_id")
      .eq("user_id", userId)
      .in("match_id", matchRows.map((m) => m.id));

    if (archivesError) throw archivesError;
    const archivedMatchIds = new Set(((archives ?? []) as MatchArchiveRow[]).map((row) => row.match_id));
    visibleMatches.push(...matchRows.filter((match) => !archivedMatchIds.has(match.id)));

    if (matchRows.length < pageSize) break;
    offset += pageSize;
  }

  return visibleMatches.slice(0, 5);
}

export interface Match {
  id: string;
  name: string;
  age: number;
  image: string;
  conversationPreview: ConversationPreview;
  /** Substring search for “matched on message” (includes `you` when preview prefix is You). */
  messageSearchHaystack: string;
  time: string;
  unread: boolean;
  vibes: string[];
  /** Canonical relationship-intent id for client-side search/display, with legacy fallback applied at fetch time. */
  looking_for: string | null;
  isNew: boolean;
  matchId: string;
  photoVerified?: boolean;
  isArchived?: boolean;
  eventName?: string;
  photos?: string[];
  about_me?: string | null;
  job?: string | null;
  location?: string | null;
  height?: number | null;
  prompts?: { question: string; answer: string }[];
  
  lifestyle?: Record<string, string>;
  tagline?: string | null;
  bunnyVideoUid?: string | null;
  vibeVideoPlaybackRef?: string | null;
  /** Deterministic sort key for "Best Match" (larger = stronger). */
  bestMatchScore: number;
  /** Same inputs as bestMatchScore; row / drawer compatibility %. */
  compatibilityPercent: number;
}

const PAGE_SIZE = 20;

export const useMatches = () => {
  const { user } = useUserProfile();
  const userId = user?.id;
  const queryClient = useQueryClient();

  // Realtime subscription for new matches
  useEffect(() => {
    if (!userId) return;

    const invalidateMatches = (payload?: { new?: MatchRealtimeRow }) => {
      const row = payload?.new;
      if (row && row.profile_id_1 !== userId && row.profile_id_2 !== userId) return;
      queryClient.invalidateQueries({ queryKey: ["matches"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-matches"] });
      queryClient.invalidateQueries({ queryKey: ["profile-live-counts"] });
    };

    const channel = supabase.channel(`matches-realtime-${userId}`);
    for (const filter of [`profile_id_1=eq.${userId}`, `profile_id_2=eq.${userId}`]) {
      channel
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "matches",
            filter,
          },
          invalidateMatches,
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "matches",
            filter,
          },
          invalidateMatches,
        );
    }
    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "match_archives",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["matches"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard-matches"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  return useQuery({
    queryKey: ["matches", userId],
    queryFn: async (): Promise<Match[]> => {
      if (!userId) return [];

      const { data: matches, error } = await supabase
        .from("matches")
        .select(`
          id,
          matched_at,
          last_message_at,
          profile_id_1,
          profile_id_2,
          archived_at,
          archived_by,
          event_id
        `)
        .or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`)
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (error) throw error;
      if (!matches?.length) return [];

      const matchIds = matches.map((m) => m.id);

      const otherProfileIds = matches.map((m) =>
        m.profile_id_1 === userId ? m.profile_id_2 : m.profile_id_1
      );

      const eventIds = matches
        .map((m) => m.event_id)
        .filter(Boolean) as string[];

      const profileIdsForFetch = [...otherProfileIds, userId];

      const [profiles, messagesResult, eventsResult, archivesResult] =
        await Promise.all([
          fetchProfilesForViewer(profileIdsForFetch),
          supabase
            .from("messages")
            .select(
              "match_id, content, created_at, read_at, sender_id, message_kind, audio_url, video_url, structured_payload"
            )
            .in(
              "match_id",
              matchIds
            )
            .order("created_at", { ascending: false }),
          eventIds.length > 0
            ? supabase
                .from("events")
                .select("id, title")
                .in("id", eventIds)
            : Promise.resolve({ data: [] }),
          supabase
            .from("match_archives")
            .select("match_id, archived_at")
            .eq("user_id", userId)
            .in("match_id", matchIds),
        ]);

      if (messagesResult.error) throw messagesResult.error;
      if ("error" in eventsResult && eventsResult.error) throw eventsResult.error;
      if (archivesResult.error) throw archivesResult.error;

      const lastMessages = messagesResult.data || [];
      const events = (eventsResult.data || []) as MatchEventRow[];
      const archives = (archivesResult.data || []) as MatchArchiveRow[];
      const archivedAtByMatch: Record<string, string> = {};
      archives.forEach((archive) => {
        archivedAtByMatch[archive.match_id] = archive.archived_at;
      });

      const messagesByMatch: Record<string, MatchLatestMessageRow> = {};
      lastMessages.forEach((msg) => {
        const row = msg as MatchLatestMessageRow;
        if (!messagesByMatch[row.match_id]) {
          messagesByMatch[row.match_id] = row;
        }
      });

      const vibesByProfile: Record<string, string[]> = {};
      profiles.forEach((profile) => {
        vibesByProfile[profile.id] = profile.vibes ?? [];
      });

      const viewerProfile = profiles.find((p) => p.id === userId);
      const viewerVibes = vibesByProfile[userId] ?? [];
      const viewerLookingFor = profileIntentForMatch(viewerProfile);

      const eventsById: Record<string, string> = {};
      events.forEach((e) => {
        eventsById[e.id] = e.title;
      });

      return matches.map((match) => {
        const otherProfileId =
          match.profile_id_1 === userId
            ? match.profile_id_2
            : match.profile_id_1;
        const profile = profiles.find((p) => p.id === otherProfileId);
        const otherVibes = vibesByProfile[otherProfileId] ?? [];
        const scoreInput: MatchScoreInput = {
          viewerVibeLabels: viewerVibes,
          otherVibeLabels: otherVibes,
          viewerLookingFor,
          otherLookingFor: profileIntentForMatch(profile),
          hasSharedEventContext: !!match.event_id,
        };
        const bestMatchScore = bestMatchSortKey(scoreInput);
        const compatibilityPct = compatibilityPercent(scoreInput);
        const lastMsg = messagesByMatch[match.id];
        const matchedAt = new Date(match.matched_at);
        const isNew =
          Date.now() - matchedAt.getTime() < 24 * 60 * 60 * 1000;
        const isArchived = !!archivedAtByMatch[match.id];

        // Canonical precedence: first valid photos[] entry, then avatar_url.
        const photoArr = profile?.photos ?? undefined;
        const rawImage = resolvePrimaryProfilePhotoPath({
          photos: photoArr,
          avatar_url: profile?.avatar_url,
        });
        const image = avatarPreset(rawImage);

        // Resolve all photos via CDN helper
        const resolvedPhotos = (photoArr || []).map((p: string) => getImageUrl(p));

        // Parse prompts from JSON
        const rawPrompts = profile?.prompts;
        const parsedPrompts = Array.isArray(rawPrompts) ? rawPrompts : [];

        const conversationPreview = lastMsg
          ? getConversationPreview(
              {
                content: lastMsg.content,
                message_kind: lastMsg.message_kind,
                audio_url: lastMsg.audio_url,
                video_url: lastMsg.video_url,
                sender_id: lastMsg.sender_id,
                structured_payload: lastMsg.structured_payload,
              },
              userId,
            )
          : getEmptyConversationPreview();

        return {
          id: otherProfileId,
          name: profile?.name || "Unknown",
          age: profile?.age || 0,
          image,
          conversationPreview,
          messageSearchHaystack: conversationPreviewSearchText(conversationPreview),
          time: lastMsg
            ? formatDistanceToNow(new Date(lastMsg.created_at), {
                addSuffix: false,
              })
            : "new",
          unread: lastMsg
            ? !lastMsg.read_at && lastMsg.sender_id !== userId
            : false,
          vibes: otherVibes,
          looking_for: profileIntentForMatch(profile),
          isNew,
          matchId: match.id,
          photoVerified: !!profile?.photo_verified,
          isArchived,
          bestMatchScore,
          compatibilityPercent: compatibilityPct,
          eventName: match.event_id
            ? eventsById[match.event_id] || undefined
            : undefined,
          photos: resolvedPhotos.length > 0 ? resolvedPhotos : undefined,
          about_me: profile?.about_me ?? null,
          job: profile?.job ?? null,
          location: profile?.location ?? null,
          height: profile?.height_cm ?? null,
          prompts: parsedPrompts as { question: string; answer: string }[],
          
          lifestyle:
            profile?.lifestyle && typeof profile.lifestyle === "object" && !Array.isArray(profile.lifestyle)
              ? (profile.lifestyle as Record<string, string>)
              : undefined,
          tagline: profile?.tagline ?? null,
          bunnyVideoUid: profile?.bunny_video_uid ?? null,
          vibeVideoPlaybackRef: profile?.vibe_video_playback_ref ?? null,
        };
      });
    },
    enabled: !!userId,
  });
};

export const useDashboardMatches = () => {
  const { user } = useUserProfile();
  const userId = user?.id;

  return useQuery<DashboardMatchPreview[]>({
    queryKey: ["dashboard-matches", userId],
    queryFn: async () => {
      if (!userId) return [];

      const dashboardMatches = await fetchDashboardVisibleMatches(userId);
      if (!dashboardMatches.length) return [];

      const otherProfileIds = dashboardMatches.map((m) =>
        m.profile_id_1 === userId ? m.profile_id_2 : m.profile_id_1
      );

      const profiles = await fetchProfilesForViewer(otherProfileIds);

      return dashboardMatches.map((match) => {
        const otherProfileId =
          match.profile_id_1 === userId
            ? match.profile_id_2
            : match.profile_id_1;
        const profile = profiles?.find((p) => p.id === otherProfileId);
        const matchedAt = new Date(match.matched_at);
        const isNew =
          Date.now() - matchedAt.getTime() < 24 * 60 * 60 * 1000;

        const rawImage = resolvePrimaryProfilePhotoPath({
          photos: (profile as { photos?: unknown } | undefined)?.photos,
          avatar_url: profile?.avatar_url,
        });
        const image = avatarPreset(rawImage);

        return {
          id: otherProfileId,
          name: profile?.name || "Unknown",
          image,
          isNew,
        };
      });
    },
    enabled: !!userId,
  });
};
