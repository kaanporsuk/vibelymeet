/**
 * Vibely Service Layer
 * 
 * This service bridges the Supabase backend with the frontend types.
 * All data transformations (snake_case → camelCase) happen here.
 * 
 * Note: Uses manual type assertions since DB types may be out of sync
 */

import { supabase } from "@/integrations/supabase/client";
import { MatchCandidate, DailyDrop, DropHistory } from "@/types/dailyDrop";
import { GamePayload } from "@/types/games";
import { TimeBlock, DateProposal } from "@/hooks/useSchedule";

// ============================================
// PROFILE SERVICE
// ============================================

export const profileService = {
  /**
   * Get current user's profile
   */
  async getCurrentProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, age, gender, job, height_cm, location, bio, avatar_url, photos, events_attended, total_matches, total_conversations, updated_at, created_at")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;
    return data ? transformProfile(data) : null;
  },

  /**
   * Get profile by ID
   */
  async getProfile(profileId: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, age, gender, job, height_cm, location, bio, avatar_url, photos, events_attended, total_matches, total_conversations, updated_at, created_at")
      .eq("id", profileId)
      .maybeSingle();

    if (error) throw error;
    return data ? transformProfile(data) : null;
  },

  /**
   * Update profile fields
   */
  async updateProfile(profileId: string, updates: Record<string, unknown>) {
    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", profileId)
      .select()
      .single();

    if (error) throw error;
    return transformProfile(data);
  },

  /**
   * Update last active timestamp
   */
  async updateLastActive(profileId: string) {
    // Use raw update since column may not be in types yet
    const { error } = await supabase
      .from("profiles")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", profileId);

    if (error) throw error;
  },

  /**
   * Get vibe tags for a profile
   */
  async getProfileVibes(profileId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from("profile_vibes")
      .select("vibe_tags(label)")
      .eq("profile_id", profileId);

    if (error) throw error;
    
    type VibeResult = { vibe_tags: { label: string } | null };
    return (data as VibeResult[])?.map(v => v.vibe_tags?.label).filter(Boolean) as string[] || [];
  },

  /**
   * Set profile vibes
   */
  async setProfileVibes(profileId: string, vibeTagIds: string[]) {
    // Delete existing vibes
    await supabase
      .from("profile_vibes")
      .delete()
      .eq("profile_id", profileId);

    // Insert new vibes
    if (vibeTagIds.length > 0) {
      const { error } = await supabase
        .from("profile_vibes")
        .insert(vibeTagIds.map(tagId => ({
          profile_id: profileId,
          vibe_tag_id: tagId
        })));

      if (error) throw error;
    }
  },

  /**
   * Get all available vibe tags
   */
  async getVibeTags(): Promise<{ id: string; label: string; emoji: string; category: string }[]> {
    const { data, error } = await supabase
      .from("vibe_tags")
      .select("id, label, emoji, category")
      .order("label");

    if (error) throw error;
    return (data || []).map(tag => ({
      id: tag.id,
      label: tag.label,
      emoji: tag.emoji,
      category: tag.category || 'lifestyle'
    }));
  },

  /**
   * Get vibe tag IDs by labels
   */
  async getVibeTagIdsByLabels(labels: string[]): Promise<string[]> {
    if (labels.length === 0) return [];

    const { data, error } = await supabase
      .from("vibe_tags")
      .select("id, label")
      .in("label", labels);

    if (error) throw error;
    return (data || []).map(tag => tag.id);
  },

  /**
   * Save complete profile (photos, bio, vibes)
   */
  async saveCompleteProfile(
    profileId: string,
    data: {
      photos?: string[];
      bio?: string;
      vibeLabels?: string[];
    }
  ) {
    // Update profile fields
    const updates: Record<string, unknown> = {};
    if (data.photos) updates.photos = data.photos;
    if (data.bio) updates.bio = data.bio;
    updates.is_onboarding_complete = true;

    const { error: profileError } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", profileId);

    if (profileError) throw profileError;

    // Save vibes if provided
    if (data.vibeLabels && data.vibeLabels.length > 0) {
      const vibeTagIds = await this.getVibeTagIdsByLabels(data.vibeLabels);
      if (vibeTagIds.length > 0) {
        await this.setProfileVibes(profileId, vibeTagIds);
      }
    }
  },

  /**
   * Get discoverable profiles
   */
  async getDiscoverableProfiles(excludeUserId?: string, limit = 50) {
    let query = supabase
      .from("profiles")
      .select("id, name, age, gender, job, height_cm, location, bio, avatar_url, photos, events_attended, total_matches, total_conversations, updated_at, created_at")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (excludeUserId) {
      query = query.neq("id", excludeUserId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map(p => transformProfile(p));
  }
};

// ============================================
// DAILY DROP SERVICE (using localStorage fallback)
// ============================================

const DROP_STORAGE_KEY = 'vibely_daily_drops';
const DROP_HISTORY_KEY = 'vibely_drop_history';

interface StoredDrop {
  id: string;
  candidateId: string;
  status: DailyDrop['status'];
  droppedAt: string;
  expiresAt: string;
  replySentAt?: string;
  dropDate: string;
}

export const dailyDropService = {
  /**
   * Get today's drop for a user (localStorage version)
   */
  async getTodaysDrop(userId: string): Promise<DailyDrop | null> {
    const today = new Date().toISOString().split('T')[0];
    
    try {
      const stored = localStorage.getItem(`${DROP_STORAGE_KEY}_${userId}`);
      if (!stored) return null;
      
      const drops: StoredDrop[] = JSON.parse(stored);
      const todaysDrop = drops.find(d => d.dropDate === today);
      
      if (!todaysDrop) return null;
      
      // Fetch candidate profile
      const { data: candidate } = await supabase
        .from("profiles")
        .select("id, name, age, gender, job, height_cm, location, bio, avatar_url, photos, events_attended, total_matches, total_conversations, updated_at, created_at")
        .eq("id", todaysDrop.candidateId)
        .maybeSingle();
      
      if (!candidate) return null;
      
      const vibes = await profileService.getProfileVibes(todaysDrop.candidateId);
      
      return {
        id: todaysDrop.id,
        candidate: transformToMatchCandidate(candidate, vibes),
        droppedAt: todaysDrop.droppedAt,
        expiresAt: todaysDrop.expiresAt,
        status: todaysDrop.status,
        replySentAt: todaysDrop.replySentAt
      };
    } catch {
      return null;
    }
  },

  /**
   * Generate a new daily drop
   */
  async generateDrop(userId: string): Promise<DailyDrop | null> {
    const today = new Date().toISOString().split('T')[0];
    const history = this.getDropHistory(userId);
    
    // Get active candidates (not in history, not the current user)
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, name, age, gender, job, height_cm, location, bio, avatar_url, photos, events_attended, total_matches, total_conversations, updated_at, created_at")
      .neq("id", userId)
      .order("updated_at", { ascending: false })
      .limit(20);
    
    if (error || !profiles?.length) return null;
    
    // Filter out seen users
    const freshCandidates = profiles.filter(p => !history.seenUserIds.includes(p.id));
    if (freshCandidates.length === 0) return null;
    
    const candidate = freshCandidates[0];
    const vibes = await profileService.getProfileVibes(candidate.id);
    
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    const newDrop: StoredDrop = {
      id: `drop-${Date.now()}`,
      candidateId: candidate.id,
      status: 'ready',
      droppedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      dropDate: today
    };
    
    // Store the drop
    try {
      const stored = localStorage.getItem(`${DROP_STORAGE_KEY}_${userId}`);
      const drops: StoredDrop[] = stored ? JSON.parse(stored) : [];
      drops.push(newDrop);
      localStorage.setItem(`${DROP_STORAGE_KEY}_${userId}`, JSON.stringify(drops));
    } catch {
      // Silent fail
    }
    
    return {
      id: newDrop.id,
      candidate: transformToMatchCandidate(candidate, vibes),
      droppedAt: newDrop.droppedAt,
      expiresAt: newDrop.expiresAt,
      status: 'ready'
    };
  },

  /**
   * Update drop status
   */
  updateDropStatus(userId: string, dropId: string, status: DailyDrop['status']) {
    try {
      const stored = localStorage.getItem(`${DROP_STORAGE_KEY}_${userId}`);
      if (!stored) return;
      
      const drops: StoredDrop[] = JSON.parse(stored);
      const dropIndex = drops.findIndex(d => d.id === dropId);
      
      if (dropIndex >= 0) {
        drops[dropIndex].status = status;
        if (status === 'replied') {
          drops[dropIndex].replySentAt = new Date().toISOString();
        }
        localStorage.setItem(`${DROP_STORAGE_KEY}_${userId}`, JSON.stringify(drops));
      }
    } catch {
      // Silent fail
    }
  },

  /**
   * Record that a user has been seen
   */
  recordSeenUser(userId: string, seenUserId: string, action: 'viewed' | 'passed' | 'replied' | 'matched') {
    try {
      const stored = localStorage.getItem(`${DROP_HISTORY_KEY}_${userId}`);
      const history: DropHistory = stored 
        ? JSON.parse(stored) 
        : { seenUserIds: [], lastDropDate: '' };
      
      if (!history.seenUserIds.includes(seenUserId)) {
        history.seenUserIds.push(seenUserId);
      }
      history.lastDropDate = new Date().toISOString().split('T')[0];
      
      localStorage.setItem(`${DROP_HISTORY_KEY}_${userId}`, JSON.stringify(history));
    } catch {
      // Silent fail
    }
  },

  /**
   * Get drop history
   */
  getDropHistory(userId: string): DropHistory {
    try {
      const stored = localStorage.getItem(`${DROP_HISTORY_KEY}_${userId}`);
      return stored ? JSON.parse(stored) : { seenUserIds: [], lastDropDate: '' };
    } catch {
      return { seenUserIds: [], lastDropDate: '' };
    }
  },

  /**
   * Reset history (for testing)
   */
  resetHistory(userId: string) {
    localStorage.removeItem(`${DROP_STORAGE_KEY}_${userId}`);
    localStorage.removeItem(`${DROP_HISTORY_KEY}_${userId}`);
  }
};

// ============================================
// MESSAGE SERVICE (with Game Support)
// ============================================

export const messageService = {
  /**
   * Subscribe to messages for a match
   */
  subscribeToMessages(matchId: string, callback: (messages: TransformedMessage[]) => void) {
    // Initial fetch
    supabase
      .from("messages")
      .select("id, match_id, sender_id, content, created_at, read_at")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) callback(data.map(transformMessage));
      });

    // Realtime subscription
    const channel = supabase
      .channel(`messages:${matchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `match_id=eq.${matchId}`
        },
        async () => {
          const { data } = await supabase
            .from("messages")
            .select("id, match_id, sender_id, content, created_at, read_at")
            .eq("match_id", matchId)
            .order("created_at", { ascending: true });
          
          if (data) callback(data.map(transformMessage));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Send a text message
   */
  async sendMessage(matchId: string, senderId: string, content: string) {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        match_id: matchId,
        sender_id: senderId,
        content
      })
      .select()
      .single();

    if (error) throw error;
    return transformMessage(data);
  },

  /**
   * Send a game message
   */
  async sendGameMessage(matchId: string, senderId: string, gamePayload: GamePayload) {
    // Store game payload in content as JSON since game_payload column may not exist yet
    const { data, error } = await supabase
      .from("messages")
      .insert({
        match_id: matchId,
        sender_id: senderId,
        content: JSON.stringify({ type: 'game', payload: gamePayload })
      })
      .select()
      .single();

    if (error) throw error;
    return transformMessage(data);
  }
};

// ============================================
// DATE PROPOSAL SERVICE (localStorage fallback)
// ============================================

const PROPOSALS_STORAGE_KEY = 'vibely_date_proposals';

export const dateProposalService = {
  /**
   * Get all proposals for a user
   */
  getProposals(userId: string): DateProposal[] {
    try {
      const stored = localStorage.getItem(`${PROPOSALS_STORAGE_KEY}_${userId}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  },

  /**
   * Create a proposal
   */
  createProposal(
    userId: string,
    receiverId: string,
    date: Date,
    block: TimeBlock,
    mode: 'video' | 'in-person',
    message: string,
    matchName?: string
  ): DateProposal {
    const proposal: DateProposal = {
      id: `proposal-${Date.now()}`,
      date,
      block,
      mode,
      message,
      status: 'pending',
      sentAt: new Date(),
      isIncoming: false,
      senderName: matchName,
      matchId: receiverId
    };

    try {
      const stored = localStorage.getItem(`${PROPOSALS_STORAGE_KEY}_${userId}`);
      const proposals: DateProposal[] = stored ? JSON.parse(stored) : [];
      proposals.push(proposal);
      localStorage.setItem(`${PROPOSALS_STORAGE_KEY}_${userId}`, JSON.stringify(proposals));
    } catch {
      // Silent fail
    }

    return proposal;
  },

  /**
   * Respond to a proposal
   */
  respondToProposal(userId: string, proposalId: string, accept: boolean) {
    try {
      const stored = localStorage.getItem(`${PROPOSALS_STORAGE_KEY}_${userId}`);
      if (!stored) return;
      
      const proposals: DateProposal[] = JSON.parse(stored);
      const index = proposals.findIndex(p => p.id === proposalId);
      
      if (index >= 0) {
        proposals[index].status = accept ? 'accepted' : 'declined';
        localStorage.setItem(`${PROPOSALS_STORAGE_KEY}_${userId}`, JSON.stringify(proposals));
      }
    } catch {
      // Silent fail
    }
  }
};



// ============================================
// AUTH SERVICE
// ============================================

export const authService = {
  /**
   * Get current session
   */
  async getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  },

  /**
   * Get current user
   */
  async getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },

  /**
   * Sign up with email
   */
  async signUp(email: string, password: string, metadata?: { name?: string }) {
    const redirectUrl = `${window.location.origin}/`;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: metadata
      }
    });

    if (error) throw error;
    return data;
  },

  /**
   * Sign in with email
   */
  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    return data;
  },

  /**
   * Sign out
   */
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  /**
   * Subscribe to auth changes
   */
  onAuthStateChange(callback: (session: unknown) => void) {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        callback(session);
      }
    );

    return () => subscription.unsubscribe();
  }
};

// ============================================
// TRANSFORMERS
// ============================================

interface TransformedMessage {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  messageType: string;
  gamePayload: GamePayload | null;
  createdAt: string;
  readAt: string | null;
}

function transformProfile(db: Record<string, unknown>) {
  return {
    id: db.id as string,
    name: db.name as string,
    age: db.age as number,
    gender: db.gender as string,
    job: db.job as string | null,
    heightCm: db.height_cm as number | null,
    location: db.location as string | null,
    bio: db.bio as string | null,
    avatarUrl: db.avatar_url as string | null,
    photos: (db.photos as string[]) || [],
    videoIntroUrl: db.video_intro_url as string | null,
    availability: db.availability as Record<string, unknown> | null,
    lastActiveAt: (db.last_active_at || db.updated_at) as string,
    isOnboardingComplete: db.is_onboarding_complete as boolean || false,
    isPaused: db.is_paused as boolean || false,
    stats: {
      events: (db.events_attended as number) || 0,
      matches: (db.total_matches as number) || 0,
      conversations: (db.total_conversations as number) || 0
    }
  };
}

function transformToMatchCandidate(db: Record<string, unknown>, vibes: string[]): MatchCandidate {
  return {
    id: db.id as string,
    name: db.name as string,
    age: db.age as number,
    lastActiveAt: (db.last_active_at || db.updated_at) as string,
    avatarUrl: (db.avatar_url as string) || '',
    vibeVideoUrl: db.video_intro_url as string | undefined,
    vibeTags: vibes,
    bio: (db.bio as string) || '',
    location: db.location as string | undefined
  };
}

function transformMessage(db: Record<string, unknown>): TransformedMessage {
  // Try to parse game payload from content if it's a game message
  let gamePayload: GamePayload | null = null;
  const content = db.content as string;
  
  try {
    const parsed = JSON.parse(content);
    if (parsed.type === 'game' && parsed.payload) {
      gamePayload = parsed.payload;
    }
  } catch {
    // Not a game message
  }

  return {
    id: db.id as string,
    matchId: db.match_id as string,
    senderId: db.sender_id as string,
    content: gamePayload ? `[Game: ${gamePayload.gameType}]` : content,
    messageType: gamePayload ? 'game_interactive' : 'text',
    gamePayload,
    createdAt: db.created_at as string,
    readAt: db.read_at as string | null
  };
}
