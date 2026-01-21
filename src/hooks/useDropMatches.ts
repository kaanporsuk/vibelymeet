import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DropMatch } from '@/components/matches/DropsTabContent';
import { MatchCandidate } from '@/types/dailyDrop';

// Transform DB profile to MatchCandidate
async function fetchCandidateProfile(candidateId: string): Promise<MatchCandidate | null> {
  const { data: candidate } = await supabase
    .from("profiles")
    .select("id, name, age, job, location, bio, avatar_url, photos, photo_verified")
    .eq("id", candidateId)
    .maybeSingle();
  
  if (!candidate) return null;
  
  // Fetch vibes
  const { data: vibeData } = await supabase
    .from("profile_vibes")
    .select("vibe_tags(label)")
    .eq("profile_id", candidateId);
  
  type VibeResult = { vibe_tags: { label: string } | null };
  const vibes = (vibeData as VibeResult[])?.map(v => v.vibe_tags?.label).filter(Boolean) as string[] || [];
  
  return {
    id: candidate.id,
    name: candidate.name,
    age: candidate.age,
    avatarUrl: candidate.avatar_url || (candidate.photos as string[])?.[0] || '',
    bio: candidate.bio || '',
    vibeTags: vibes,
    lastActiveAt: new Date().toISOString(),
    location: candidate.location || undefined,
  };
}

export function useDropMatches() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['drop-matches', user?.id],
    queryFn: async (): Promise<DropMatch[]> => {
      if (!user) return [];

      // Fetch all drops for this user
      const { data: drops, error } = await supabase
        .from('daily_drops')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching drops:', error);
        return [];
      }

      if (!drops || drops.length === 0) return [];

      // Transform each drop
      const dropMatches: DropMatch[] = [];
      
      for (const drop of drops) {
        const candidate = await fetchCandidateProfile(drop.candidate_id);
        if (!candidate) continue;

        // Map DB status to DropMatch status
        let status: DropMatch['status'] = 'sent';
        if (drop.status === 'replied') status = 'sent'; // User replied, waiting for response
        if (drop.status === 'passed') status = 'passed';
        if (drop.status === 'expired') status = 'expired';
        if (drop.status === 'matched') status = 'matched';
        if (drop.status === 'ready' || drop.status === 'viewed') status = 'received'; // Drop available to view
        
        // Check if expired
        if (new Date(drop.expires_at) < new Date() && status !== 'matched' && status !== 'passed') {
          status = 'expired';
        }

        dropMatches.push({
          id: drop.id,
          candidate: {
            ...candidate,
            photoVerified: false, // Would need to join with profiles table for this
          },
          status,
          sentAt: drop.dropped_at,
          matchedAt: drop.status === 'matched' ? drop.created_at : undefined,
          hasUnreadMessage: false, // Would need to check messages table
        });
      }

      return dropMatches;
    },
    enabled: !!user,
    staleTime: 30000, // 30 seconds
  });
}