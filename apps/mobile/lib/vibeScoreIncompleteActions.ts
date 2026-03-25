/**
 * Client-side derivation of incomplete profile actions for Vibe Score drawer.
 * Weights mirror `public.calculate_vibe_score` (see supabase/migrations/*_fix_vibe_score*.sql).
 */
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { ProfileRow } from '@/lib/profileApi';

export type VibeScoreActionId =
  | 'photos'
  | 'vibe_video'
  | 'prompts'
  | 'bio'
  | 'tagline'
  | 'looking_for'
  | 'job'
  | 'height'
  | 'lifestyle'
  | 'phone'
  | 'email'
  | 'photo_verify'
  | 'name';

export type VibeScoreIncompleteAction = {
  id: VibeScoreActionId;
  label: string;
  points: number;
  icon: ComponentProps<typeof Ionicons>['name'];
  /** Optional; drawer may ignore — kept for parity with copy spec. */
  sublabel?: string;
};

function countNonEmptyPhotos(photos: ProfileRow['photos']): number {
  return (photos ?? []).filter((p) => typeof p === 'string' && p.trim().length > 0).length;
}

function countPromptAnswers(profile: ProfileRow): number {
  const prompts = profile.prompts ?? [];
  return prompts.filter((p) => (p.answer ?? '').trim().length > 0).length;
}

function bioLength(profile: ProfileRow): number {
  return (profile.about_me ?? '').trim().length;
}

function hasLifestyleForScore(lifestyle: ProfileRow['lifestyle']): boolean {
  if (!lifestyle || typeof lifestyle !== 'object') return false;
  return Object.keys(lifestyle as Record<string, unknown>).length > 0;
}

export function tierLabelFromScore(score: number): string {
  if (score >= 90) return 'Iconic';
  if (score >= 75) return 'Fire';
  if (score >= 60) return 'Excellent';
  if (score >= 45) return 'Rising';
  if (score >= 25) return 'Getting Started';
  return 'New';
}

export function getNextTierLine(score: number): { name: string; at: number } | null {
  if (score >= 90) return null;
  if (score >= 75) return { name: 'Iconic', at: 90 };
  if (score >= 60) return { name: 'Fire', at: 75 };
  if (score >= 45) return { name: 'Excellent', at: 60 };
  if (score >= 25) return { name: 'Rising', at: 45 };
  return { name: 'Getting Started', at: 25 };
}

export function getIncompleteVibeScoreActions(profile: ProfileRow): VibeScoreIncompleteAction[] {
  const out: VibeScoreIncompleteAction[] = [];

  const photoCount = countNonEmptyPhotos(profile.photos);
  if (photoCount < 6) {
    const need = 6 - photoCount;
    out.push({
      id: 'photos',
      label: need === 1 ? 'Add 1 more photo' : `Add ${need} more photos`,
      points: need * 5,
      icon: 'images-outline',
    });
  }

  const videoUid = profile.bunny_video_uid?.trim();
  if (!videoUid) {
    out.push({
      id: 'vibe_video',
      label: 'Add Vibe Video',
      points: 15,
      icon: 'videocam-outline',
    });
  }

  const promptCount = countPromptAnswers(profile);
  if (promptCount < 3) {
    let remainingPoints = 0;
    if (promptCount === 0) remainingPoints = 10;
    else if (promptCount === 1) remainingPoints = 6;
    else if (promptCount === 2) remainingPoints = 3;

    const need = 3 - promptCount;
    const label =
      promptCount === 0
        ? 'Add conversation starters'
        : `Add ${need} more prompt${need > 1 ? 's' : ''}`;

    out.push({
      id: 'prompts',
      label,
      sublabel: 'Start better conversations',
      points: remainingPoints,
      icon: 'chatbubble-ellipses-outline',
    });
  }

  if (bioLength(profile) <= 10) {
    out.push({
      id: 'bio',
      label: 'Write your bio',
      points: 10,
      icon: 'document-text-outline',
    });
  }

  if (!(profile.tagline?.trim())) {
    out.push({
      id: 'tagline',
      label: 'Add tagline',
      points: 5,
      icon: 'text-outline',
    });
  }

  if (!(profile.looking_for?.trim())) {
    out.push({
      id: 'looking_for',
      label: 'Set looking for',
      points: 5,
      icon: 'heart-outline',
    });
  }

  if (!(profile.job?.trim())) {
    out.push({
      id: 'job',
      label: 'Add job title',
      points: 3,
      icon: 'briefcase-outline',
    });
  }

  if (profile.height_cm == null || profile.height_cm === 0) {
    out.push({
      id: 'height',
      label: 'Add height',
      points: 2,
      icon: 'resize-outline',
    });
  }

  if (!hasLifestyleForScore(profile.lifestyle)) {
    out.push({
      id: 'lifestyle',
      label: 'Add lifestyle',
      points: 2,
      icon: 'leaf-outline',
    });
  }

  if (!profile.phone_verified) {
    out.push({
      id: 'phone',
      label: 'Verify phone',
      points: 5,
      icon: 'call-outline',
    });
  }

  if (!profile.email_verified) {
    out.push({
      id: 'email',
      label: 'Verify email',
      points: 3,
      icon: 'mail-outline',
    });
  }

  if (!profile.photo_verified) {
    out.push({
      id: 'photo_verify',
      label: 'Verify photo',
      points: 5,
      icon: 'camera-outline',
    });
  }

  if (!(profile.name?.trim())) {
    out.push({
      id: 'name',
      label: 'Add name',
      points: 5,
      icon: 'person-outline',
    });
  }

  out.sort((a, b) => b.points - a.points);
  return out;
}
