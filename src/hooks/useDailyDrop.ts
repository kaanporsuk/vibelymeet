import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { 
  DailyDrop, 
  DropZoneState, 
  DropHistory,
  DROP_HOUR,
  MatchCandidate
} from '@/types/dailyDrop';

function isDropTimeReached(): boolean {
  const now = new Date();
  return now.getHours() >= DROP_HOUR;
}

function getTimeUntilNextDrop(): { hours: number; minutes: number; seconds: number } {
  const now = new Date();
  let targetTime: Date;
  
  if (now.getHours() >= DROP_HOUR) {
    // Next drop is tomorrow
    targetTime = new Date(now);
    targetTime.setDate(targetTime.getDate() + 1);
    targetTime.setHours(DROP_HOUR, 0, 0, 0);
  } else {
    // Today's drop
    targetTime = new Date(now);
    targetTime.setHours(DROP_HOUR, 0, 0, 0);
  }
  
  const diff = targetTime.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  
  return { hours, minutes, seconds };
}

// Transform DB profile to MatchCandidate
function transformToMatchCandidate(profile: Record<string, unknown>, vibes: string[] = []): MatchCandidate {
  return {
    id: profile.id as string,
    name: profile.name as string,
    age: profile.age as number,
    avatarUrl: (profile.avatar_url as string) || (profile.photos as string[])?.[0] || '',
    bio: (profile.bio as string) || '',
    vibeTags: vibes,
    lastActiveAt: (profile.updated_at as string) || new Date().toISOString(),
    location: profile.location as string | undefined,
  };
}

export function useDailyDrop() {
  const { user } = useAuth();
  const [state, setState] = useState<DropZoneState>('locked');
  const [currentDrop, setCurrentDrop] = useState<DailyDrop | null>(null);
  const [countdown, setCountdown] = useState(getTimeUntilNextDrop());
  const [history, setHistory] = useState<DropHistory>({ seenUserIds: [], lastDropDate: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [hasEligibleCandidates, setHasEligibleCandidates] = useState<boolean | null>(null);

  // Fetch candidate profile with vibes
  const fetchCandidateWithVibes = useCallback(async (candidateId: string): Promise<MatchCandidate | null> => {
    const { data: candidate } = await supabase
      .from("profiles")
      .select("id, name, age, job, location, bio, avatar_url, photos")
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
    
    return transformToMatchCandidate(candidate, vibes);
  }, []);

  // Transform DB drop to DailyDrop
  const transformDrop = useCallback(async (dbDrop: Record<string, unknown>): Promise<DailyDrop | null> => {
    const candidate = await fetchCandidateWithVibes(dbDrop.candidate_id as string);
    if (!candidate) return null;
    
    return {
      id: dbDrop.id as string,
      candidate,
      droppedAt: dbDrop.dropped_at as string,
      expiresAt: dbDrop.expires_at as string,
      status: dbDrop.status as DailyDrop['status'],
    };
  }, [fetchCandidateWithVibes]);

  // Check if eligible candidates exist
  const checkEligibleCandidates = useCallback(async (seenIds: string[]): Promise<boolean> => {
    if (!user) return false;
    
    try {
      // Fetch current user's profile to get their interested_in preferences
      const { data: currentUserProfile } = await supabase
        .from("profiles")
        .select("interested_in, gender")
        .eq("id", user.id)
        .maybeSingle();
      
      const interestedIn = currentUserProfile?.interested_in || [];
      const currentUserGender = currentUserProfile?.gender;
      
      // Build query to find potential candidates
      let query = supabase
        .from("profiles")
        .select("id, gender, interested_in")
        .neq("id", user.id)
        .limit(50);
      
      // Filter by user's interested_in preferences if set
      if (interestedIn.length > 0) {
        query = query.in("gender", interestedIn);
      }
      
      const { data: profiles } = await query;
      
      if (!profiles?.length) return false;
      
      // Filter out seen users and ensure bidirectional interest match
      const freshCandidates = profiles.filter(p => {
        if (seenIds.includes(p.id)) return false;
        
        const candidateInterestedIn = (p.interested_in as string[]) || [];
        if (candidateInterestedIn.length > 0 && currentUserGender) {
          if (!candidateInterestedIn.includes(currentUserGender)) return false;
        }
        
        return true;
      });
      
      return freshCandidates.length > 0;
    } catch (error) {
      console.error('Error checking eligible candidates:', error);
      return false;
    }
  }, [user]);

  // Initialize drop state from database
  useEffect(() => {
    const initializeDrop = async () => {
      if (!user) {
        setState('locked');
        setIsLoading(false);
        setHasEligibleCandidates(false);
        return;
      }

      try {
        const today = new Date().toISOString().split('T')[0];
        
        // Load seen user history from all previous drops first
        const { data: allDrops } = await supabase
          .from("daily_drops")
          .select("candidate_id, drop_date")
          .eq("user_id", user.id);
        
        let seenUserIds: string[] = [];
        if (allDrops && allDrops.length > 0) {
          seenUserIds = allDrops.map(d => d.candidate_id);
          const lastDropDate = allDrops.reduce((latest, d) => 
            d.drop_date > latest ? d.drop_date : latest, allDrops[0].drop_date);
          setHistory({ seenUserIds, lastDropDate });
        }
        
        // Check for existing drop today from database
        const { data: existingDrop, error } = await supabase
          .from("daily_drops")
          .select("*")
          .eq("user_id", user.id)
          .eq("drop_date", today)
          .maybeSingle();
        
        if (error) {
          console.error("Error fetching daily drop:", error);
        }
        
        if (existingDrop) {
          const drop = await transformDrop(existingDrop);
          if (drop) {
            setCurrentDrop(drop);
            setHasEligibleCandidates(true);
            
            if (existingDrop.status === 'replied') {
              setState('pending');
            } else if (existingDrop.status === 'viewed') {
              setState('reveal');
            } else if (existingDrop.status === 'passed') {
              setState('locked');
            } else {
              setState('ready');
            }
          }
        } else {
          // Check if there are eligible candidates before showing ready state
          const hasEligible = await checkEligibleCandidates(seenUserIds);
          setHasEligibleCandidates(hasEligible);
          
          if (isDropTimeReached() && hasEligible) {
            setState('ready');
          } else if (!hasEligible) {
            setState('empty');
          } else {
            setState('locked');
          }
        }
      } catch (error) {
        console.error('Failed to initialize daily drop:', error);
        setState('locked');
        setHasEligibleCandidates(false);
      } finally {
        setIsLoading(false);
      }
    };

    initializeDrop();
  }, [user, transformDrop, checkEligibleCandidates]);

  // Realtime subscription for daily_drops updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`daily_drops:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_drops',
          filter: `user_id=eq.${user.id}`
        },
        async (payload) => {
          console.log('Daily drop realtime update:', payload);
          const today = new Date().toISOString().split('T')[0];
          
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const dbDrop = payload.new as Record<string, unknown>;
            
            // Only update if it's today's drop
            if (dbDrop.drop_date === today) {
              const drop = await transformDrop(dbDrop);
              if (drop) {
                setCurrentDrop(drop);
                
                const status = dbDrop.status as string;
                if (status === 'replied') {
                  setState('pending');
                } else if (status === 'viewed') {
                  setState('reveal');
                } else if (status === 'passed') {
                  setState('locked');
                } else {
                  setState('ready');
                }
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, transformDrop]);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(getTimeUntilNextDrop());
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);

  // Unlock and view the drop
  const unlockDrop = useCallback(async () => {
    if (!user) return;

    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Check if we already have today's drop
      const { data: existingDrop } = await supabase
        .from("daily_drops")
        .select("*")
        .eq("user_id", user.id)
        .eq("drop_date", today)
        .maybeSingle();
      
      if (existingDrop) {
        const drop = await transformDrop(existingDrop);
        if (drop) {
          // Update status to viewed
          await supabase
            .from("daily_drops")
            .update({ status: 'viewed' })
            .eq("id", existingDrop.id);
          
          setCurrentDrop({ ...drop, status: 'viewed' });
          setState('reveal');
        }
        return;
      }
      
      // Fetch current user's profile to get their interested_in preferences
      const { data: currentUserProfile } = await supabase
        .from("profiles")
        .select("interested_in, gender")
        .eq("id", user.id)
        .maybeSingle();
      
      const interestedIn = currentUserProfile?.interested_in || [];
      
      // Generate a new drop - find candidates matching gender preferences
      let query = supabase
        .from("profiles")
        .select("id, name, age, job, location, bio, avatar_url, photos, gender, interested_in")
        .neq("id", user.id)
        .order("updated_at", { ascending: false })
        .limit(50);
      
      // Filter by user's interested_in preferences if set
      if (interestedIn.length > 0) {
        query = query.in("gender", interestedIn);
      }
      
      const { data: profiles } = await query;
      
      if (!profiles?.length) {
        setState('empty');
        return;
      }
      
      // Filter out seen users and ensure bidirectional interest match
      const currentUserGender = currentUserProfile?.gender;
      const freshCandidates = profiles.filter(p => {
        // Must not be seen before
        if (history.seenUserIds.includes(p.id)) return false;
        
        // Bidirectional match: candidate should be interested in current user's gender
        const candidateInterestedIn = (p.interested_in as string[]) || [];
        if (candidateInterestedIn.length > 0 && currentUserGender) {
          if (!candidateInterestedIn.includes(currentUserGender)) return false;
        }
        
        return true;
      });
      
      if (freshCandidates.length === 0) {
        setState('empty');
        return;
      }
      
      const candidateProfile = freshCandidates[0];
      
      // Insert new drop into database
      const { data: newDropData, error } = await supabase
        .from("daily_drops")
        .insert({
          user_id: user.id,
          candidate_id: candidateProfile.id,
          status: 'viewed',
          drop_date: today
        })
        .select()
        .single();
      
      if (error) {
        console.error("Error creating daily drop:", error);
        return;
      }
      
      const drop = await transformDrop(newDropData);
      if (drop) {
        setCurrentDrop({ ...drop, status: 'viewed' });
        setState('reveal');
        
        // Update history
        setHistory(prev => ({
          seenUserIds: [...prev.seenUserIds, candidateProfile.id],
          lastDropDate: today,
          todayDropId: newDropData.id
        }));
      }
    } catch (error) {
      console.error('Failed to unlock drop:', error);
    }
  }, [user, history.seenUserIds, transformDrop]);

  // Send vibe reply
  const sendVibeReply = useCallback(async (videoUrl?: string) => {
    if (!currentDrop || !user) return;
    
    await supabase
      .from("daily_drops")
      .update({ status: 'replied' })
      .eq("id", currentDrop.id);
    
    setCurrentDrop({
      ...currentDrop,
      status: 'replied',
      replySentAt: new Date().toISOString()
    });
    setState('pending');
  }, [currentDrop, user]);

  // Pass on the drop
  const passDrop = useCallback(async () => {
    if (!currentDrop || !user) return;
    
    await supabase
      .from("daily_drops")
      .update({ status: 'passed' })
      .eq("id", currentDrop.id);
    
    setCurrentDrop({
      ...currentDrop,
      status: 'passed'
    });
    setState('locked');
  }, [currentDrop, user]);

  // Get time remaining until drop expires
  const getExpiryCountdown = useCallback(() => {
    if (!currentDrop) return { hours: 0, minutes: 0 };
    
    const now = new Date();
    const expires = new Date(currentDrop.expiresAt);
    const diff = expires.getTime() - now.getTime();
    
    if (diff <= 0) return { hours: 0, minutes: 0 };
    
    return {
      hours: Math.floor(diff / (1000 * 60 * 60)),
      minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    };
  }, [currentDrop]);

  // Reset for testing
  const resetHistory = useCallback(async () => {
    if (!user) return;
    
    // Delete all drops for this user (for testing only)
    await supabase
      .from("daily_drops")
      .delete()
      .eq("user_id", user.id);
    
    setHistory({ seenUserIds: [], lastDropDate: '' });
    setState('ready');
    setCurrentDrop(null);
  }, [user]);

  return {
    state,
    currentDrop,
    countdown,
    isLoading,
    hasEligibleCandidates,
    unlockDrop,
    sendVibeReply,
    passDrop,
    getExpiryCountdown,
    resetHistory,
    isDropTimeReached: isDropTimeReached()
  };
}
