/**
 * Client-side incomplete profile actions for Vibe Score drawer (web port of
 * apps/mobile/lib/vibeScoreIncompleteActions.ts). Logic mirrors native and the
 * authoritative backend score contract.
 */

import { normalizeBunnyVideoStatus } from "@/lib/vibeVideo/webVibeVideoState";

export type VibeScoreActionId =
  | "vibes"
  | "photos"
  | "vibe_video"
  | "prompts"
  | "about_me"
  | "tagline"
  | "looking_for"
  | "job"
  | "height"
  | "lifestyle"
  | "phone"
  | "email"
  | "photo_verify"
  | "name";

export type VibeScoreIncompleteAction = {
  id: VibeScoreActionId;
  label: string;
  points: number;
  /** Lucide icon name for mapping in UI */
  icon: VibeScoreActionIcon;
  sublabel?: string;
};

export type VibeScoreActionIcon =
  | "sparkles"
  | "images"
  | "video"
  | "message"
  | "fileText"
  | "type"
  | "heart"
  | "briefcase"
  | "ruler"
  | "leaf"
  | "phone"
  | "mail"
  | "camera"
  | "user";

/** Snapshot shape for scoring — camelCase web profile fields */
export type VibeScoreProfileSnapshot = {
  photos: string[];
  bunnyVideoUid: string | null;
  bunnyVideoStatus?: string | null;
  vibes?: string[] | null;
  prompts: { question?: string | null; answer?: string | null }[];
  aboutMe: string | null;
  tagline: string | null;
  relationshipIntent?: string | null;
  lookingFor: string | null;
  job: string | null;
  heightCm: number | null;
  lifestyle: Record<string, string> | null | undefined;
  phoneVerified: boolean;
  emailVerified: boolean;
  photoVerified: boolean;
  name: string | null;
};

function countNonEmptyPhotos(photos: string[] | undefined): number {
  return (photos ?? []).filter((p) => typeof p === "string" && p.trim().length > 0).length;
}

function countPromptAnswers(profile: VibeScoreProfileSnapshot): number {
  const prompts = profile.prompts ?? [];
  return prompts.filter((p) => (p.answer ?? "").trim().length > 0).length;
}

function aboutMeLength(profile: VibeScoreProfileSnapshot): number {
  return (profile.aboutMe ?? "").trim().length;
}

function hasLifestyleForScore(lifestyle: VibeScoreProfileSnapshot["lifestyle"]): boolean {
  if (!lifestyle || typeof lifestyle !== "object") return false;
  return Object.keys(lifestyle as Record<string, unknown>).length > 0;
}

export function tierLabelFromScore(score: number): string {
  if (score >= 90) return "Iconic";
  if (score >= 75) return "Fire";
  if (score >= 60) return "Excellent";
  if (score >= 45) return "Rising";
  if (score >= 25) return "Getting Started";
  return "New";
}

export function getNextTierLine(score: number): { name: string; at: number } | null {
  if (score >= 90) return null;
  if (score >= 75) return { name: "Iconic", at: 90 };
  if (score >= 60) return { name: "Fire", at: 75 };
  if (score >= 45) return { name: "Excellent", at: 60 };
  if (score >= 25) return { name: "Rising", at: 45 };
  return { name: "Getting Started", at: 25 };
}

export function getIncompleteVibeScoreActions(profile: VibeScoreProfileSnapshot): VibeScoreIncompleteAction[] {
  const out: VibeScoreIncompleteAction[] = [];

  const vibeCount = (profile.vibes ?? []).filter((v) => (v ?? "").trim().length > 0).length;
  if (vibeCount === 0) {
    out.push({
      id: "vibes",
      label: "Select your vibes",
      points: 12,
      icon: "sparkles",
    });
  }

  const photoCount = countNonEmptyPhotos(profile.photos);
  if (photoCount < 6) {
    const need = 6 - photoCount;
    out.push({
      id: "photos",
      label: need === 1 ? "Add 1 more photo" : `Add ${need} more photos`,
      points: need * 5,
      icon: "images",
    });
  }

  const videoUid = profile.bunnyVideoUid?.trim();
  const videoStatus = normalizeBunnyVideoStatus(profile.bunnyVideoStatus);
  if (!videoUid || videoStatus !== "ready") {
    out.push({
      id: "vibe_video",
      label: "Add Vibe Video",
      points: 15,
      icon: "video",
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
        ? "Add conversation starters"
        : `Add ${need} more prompt${need > 1 ? "s" : ""}`;

    out.push({
      id: "prompts",
      label,
      sublabel: "Start better conversations",
      points: remainingPoints,
      icon: "message",
    });
  }

  if (aboutMeLength(profile) <= 10) {
    out.push({
      id: "about_me",
      label: "Write your bio",
      points: 10,
      icon: "fileText",
    });
  }

  if (!profile.tagline?.trim()) {
    out.push({
      id: "tagline",
      label: "Add tagline",
      points: 5,
      icon: "type",
    });
  }

  const intentValue = profile.relationshipIntent?.trim() || profile.lookingFor?.trim() || "";
  if (!intentValue) {
    out.push({
      id: "looking_for",
      label: "Set relationship intent",
      points: 5,
      icon: "heart",
    });
  }

  if (!profile.job?.trim()) {
    out.push({
      id: "job",
      label: "Add job title",
      points: 3,
      icon: "briefcase",
    });
  }

  if (profile.heightCm == null || profile.heightCm === 0) {
    out.push({
      id: "height",
      label: "Add height",
      points: 2,
      icon: "ruler",
    });
  }

  if (!hasLifestyleForScore(profile.lifestyle)) {
    out.push({
      id: "lifestyle",
      label: "Add lifestyle",
      points: 2,
      icon: "leaf",
    });
  }

  if (!profile.phoneVerified) {
    out.push({
      id: "phone",
      label: "Verify phone number",
      points: 5,
      icon: "phone",
    });
  }

  if (!profile.emailVerified) {
    out.push({
      id: "email",
      label: "Verify current email",
      points: 3,
      icon: "mail",
    });
  }

  if (!profile.photoVerified) {
    out.push({
      id: "photo_verify",
      label: "Verify photo",
      points: 5,
      icon: "camera",
    });
  }

  if (!profile.name?.trim()) {
    out.push({
      id: "name",
      label: "Add name",
      points: 5,
      icon: "user",
    });
  }

  out.sort((a, b) => b.points - a.points);
  return out;
}
