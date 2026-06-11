import { supabase } from '@/lib/supabase';
import { fetchVideoDatePartnerProfile } from '@/lib/videoDatePartnerProfile';

type VideoSessionParticipants = {
  participant_1_id?: string | null;
  participant_2_id?: string | null;
};

type ProfileVibeJoinRow = {
  vibe_tags?: { label?: string | null } | Array<{ label?: string | null }> | null;
};

function normalizeVibeLabel(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (value && typeof value === 'object' && 'label' in value) {
    return normalizeVibeLabel((value as { label?: unknown }).label);
  }
  return null;
}

function uniqueLabels(labels: Array<string | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels) {
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

function profileVibeLabels(profile: unknown): string[] {
  if (!profile || typeof profile !== 'object') return [];
  const vibes = (profile as { vibes?: unknown }).vibes;
  if (!Array.isArray(vibes)) return [];
  return uniqueLabels(vibes.map(normalizeVibeLabel));
}

function joinedVibeLabels(rows: ProfileVibeJoinRow[] | null | undefined): string[] {
  return uniqueLabels(
    (rows ?? []).flatMap((row) => {
      const tag = row.vibe_tags;
      return Array.isArray(tag) ? tag.map(normalizeVibeLabel) : [normalizeVibeLabel(tag)];
    }),
  );
}

function resolvePartnerId(session: VideoSessionParticipants | null, userId: string): string | null {
  if (!session) return null;
  if (session.participant_1_id === userId) return session.participant_2_id ?? null;
  if (session.participant_2_id === userId) return session.participant_1_id ?? null;
  return null;
}

export async function fetchReadyGateSharedVibes(input: {
  sessionId: string | null | undefined;
  userId: string | null | undefined;
  limit?: number;
}): Promise<string[]> {
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
  const limit = Math.max(1, Math.min(6, input.limit ?? 4));
  if (!sessionId || !userId) return [];

  const { data: session, error: sessionError } = await supabase
    .from('video_sessions')
    .select('participant_1_id, participant_2_id')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionError || !session) return [];

  const partnerId = resolvePartnerId(session as VideoSessionParticipants, userId);
  if (!partnerId) return [];

  const [viewerVibesResult, partnerProfileResult] = await Promise.all([
    supabase
      .from('profile_vibes')
      .select('vibe_tags(label)')
      .eq('profile_id', userId),
    fetchVideoDatePartnerProfile(partnerId),
  ]);

  if (viewerVibesResult.error || partnerProfileResult.error) return [];

  const viewerLabels = new Set(
    joinedVibeLabels(viewerVibesResult.data as ProfileVibeJoinRow[] | null).map((label) => label.toLowerCase()),
  );
  if (!viewerLabels.size) return [];

  return profileVibeLabels(partnerProfileResult.data)
    .filter((label) => viewerLabels.has(label.toLowerCase()))
    .slice(0, limit);
}
