import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin, Play, Pencil, Loader2, Camera, Mail, Phone, Briefcase, Ruler, Cake, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyProfile, getZodiacSign, getZodiacEmoji, calculateAge, type ProfileData } from "@/services/profileService";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import { LifestyleDetails } from "@/components/LifestyleDetails";
import { BottomNav } from "@/components/BottomNav";
import { cn } from "@/lib/utils";

const PROMPT_EMOJIS: Record<string, string> = {
  "A shower thought I had recently": "🚿",
  "My simple pleasures": "✨",
  "The way to win me over": "💫",
  "I geek out on": "🤓",
  "Together, we could": "🌙",
  "My most controversial opinion": "🔥",
  "I'm looking for": "🔮",
  "A life goal of mine": "🎯",
  "My love language is": "💕",
  "Two truths and a lie": "🎭",
};

interface UserProfile {
  id: string;
  name: string;
  birthDate: Date | null;
  age: number | null;
  zodiac: string | null;
  tagline: string | null;
  job: string | null;
  heightCm: number | null;
  location: string | null;
  aboutMe: string | null;
  photos: string[];
  vibes: string[];
  prompts: { question: string; answer: string }[];
  lookingFor: string | null;
  lifestyle: Record<string, string>;
  photoVerified: boolean;
  bunnyVideoUid: string | null;
  bunnyVideoStatus: string;
  vibeCaption: string;
}

const INTENT_MAP: Record<string, { label: string; emoji: string }> = {
  "long-term": { label: "Long-term relationship", emoji: "💍" },
  "short-term": { label: "Short-term, open to long", emoji: "💫" },
  casual: { label: "Casual dating", emoji: "🎉" },
  friends: { label: "New friends", emoji: "🤝" },
  unsure: { label: "Still figuring it out", emoji: "🤔" },
};

const ProfilePreview = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: flags } = await supabase
            .from("profiles")
            .select("phone_verified, email_verified")
            .eq("id", user.id)
            .maybeSingle();
          if (flags?.phone_verified) setPhoneVerified(true);
          if (flags?.email_verified) setEmailVerified(true);
        }
        const data = await fetchMyProfile();
        if (data) {
          setProfile({
            id: data.id,
            name: data.name,
            birthDate: data.birthDate,
            age: data.age,
            zodiac: data.zodiac,
            tagline: data.tagline,
            job: data.job,
            heightCm: data.heightCm,
            location: data.location,
            aboutMe: data.aboutMe,
            photos: data.photos,
            vibes: data.vibes,
            prompts: data.prompts?.filter((p) => p.question?.trim() && p.answer?.trim()) ?? [],
            lookingFor: data.lookingFor,
            lifestyle: data.lifestyle,
            photoVerified: data.photoVerified || false,
            bunnyVideoUid: data.bunnyVideoUid || null,
            bunnyVideoStatus: data.bunnyVideoStatus || "none",
            vibeCaption: (data as any).vibeCaption || "",
          });
        }
      } catch (e) {
        console.error("Error loading preview:", e);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  if (isLoading || !profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasVibeVideo = !!(profile.bunnyVideoUid && profile.bunnyVideoStatus === "ready");
  const thumbnailUrl = profile.bunnyVideoUid
    ? `https://${import.meta.env.VITE_BUNNY_STREAM_CDN_HOSTNAME}/${profile.bunnyVideoUid}/thumbnail.jpg`
    : null;
  const filledPhotos = profile.photos.filter(Boolean);
  const lookingForDisplay = profile.lookingFor ? INTENT_MAP[profile.lookingFor] : null;
  const lifestyleKeys = Object.keys(profile.lifestyle).filter((k) => k !== "meeting_preference");
  const hasLifestyle = lifestyleKeys.length > 0;
  const hasBasics = !!(profile.birthDate || profile.job || profile.heightCm || profile.location);

  return (
    <div className="min-h-screen bg-background pb-[100px]">
      {/* ═══ Hero gradient ═══ */}
      <div className="relative">
        <div className="h-[250px] w-full bg-gradient-to-br from-violet-500 to-pink-500 relative overflow-hidden">
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
          />
        </div>

        {/* Header bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-12 z-10">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full" style={{ background: "rgba(0,0,0,0.2)", backdropFilter: "blur(8px)" }}>
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <span className="text-white font-display font-bold text-base">Profile Preview</span>
          <button onClick={() => navigate(-1)} className="text-white text-sm font-semibold px-3 py-1.5 rounded-full" style={{ background: "rgba(0,0,0,0.2)", backdropFilter: "blur(8px)" }}>
            Edit
          </button>
        </div>

        {/* Avatar */}
        <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 z-10">
          {profile.photos[0] ? (
            <img
              src={resolvePhotoUrl(profile.photos[0])}
              alt={profile.name}
              className="w-40 h-40 rounded-[20px] object-cover border-4 border-background shadow-2xl"
            />
          ) : (
            <div className="w-40 h-40 rounded-[20px] bg-secondary border-4 border-background flex items-center justify-center">
              <Camera className="w-16 h-16 text-muted-foreground/30" />
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-24">
        {/* ═══ Identity ═══ */}
        <div className="text-center space-y-1.5 mb-8">
          <h1 className="text-2xl font-display font-bold text-white">
            {profile.name}{profile.age != null ? `, ${profile.age}` : ""}
          </h1>
          {profile.tagline && (
            <p className="text-sm italic text-violet-400">"{profile.tagline}"</p>
          )}
          {profile.location && (
            <div className="flex items-center justify-center gap-1 text-gray-400">
              <MapPin className="w-3.5 h-3.5" />
              <span className="text-sm">{profile.location}</span>
            </div>
          )}

          {/* Verification badges */}
          {(emailVerified || phoneVerified || profile.photoVerified) && (
            <div className="flex items-center justify-center gap-2 pt-2">
              {emailVerified && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-teal-500/15 border border-teal-500/30 text-teal-400">
                  <Mail className="w-3 h-3" /> Email
                </span>
              )}
              {profile.photoVerified && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-teal-500/15 border border-teal-500/30 text-teal-400">
                  <Camera className="w-3 h-3" /> Photo
                </span>
              )}
              {phoneVerified && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-teal-500/15 border border-teal-500/30 text-teal-400">
                  <Phone className="w-3 h-3" /> Phone
                </span>
              )}
            </div>
          )}
        </div>

        {/* ═══ Vibe Video ═══ */}
        {hasVibeVideo && (
          <div className="mb-6">
            <div className="relative w-full rounded-2xl overflow-hidden bg-secondary" style={{ aspectRatio: "16/9" }}>
              {thumbnailUrl && (
                <img src={thumbnailUrl} alt="Vibe Video" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.3)" }}>
                  <Play className="w-7 h-7 text-white ml-1" />
                </div>
              </div>
              {profile.vibeCaption && (
                <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
                  <p className="text-[10px] font-semibold uppercase tracking-widest bg-gradient-to-r from-violet-500 to-pink-500 bg-clip-text text-transparent mb-0.5">Vibing on</p>
                  <p className="text-white text-sm font-bold">{profile.vibeCaption}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ About Me ═══ */}
        {profile.aboutMe && (
          <div className="mb-6">
            <h3 className="text-lg font-display font-bold text-white mb-2">About Me</h3>
            <p className="text-sm text-gray-400 leading-relaxed">{profile.aboutMe}</p>
          </div>
        )}

        {/* ═══ Conversation Starters ═══ */}
        {profile.prompts.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-display font-bold text-white mb-3">Conversation Starters</h3>
            <div className="space-y-3">
              {profile.prompts.map((p, i) => {
                const emoji = PROMPT_EMOJIS[p.question] ?? "💭";
                return (
                  <div
                    key={`${i}-${p.question}`}
                    className="relative rounded-2xl bg-white/5 backdrop-blur border border-white/10 overflow-hidden"
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-violet-500 to-pink-500" />
                    <div className="p-4 pl-5">
                      <div className="flex items-start gap-2">
                        <span className="text-lg mt-0.5">{emoji}</span>
                        <span className="text-sm font-semibold text-gray-400">{p.question}</span>
                      </div>
                      <p className="text-base font-semibold text-white mt-2">{p.answer}</p>
                      <div className="flex items-center gap-1.5 mt-3">
                        <MessageCircle className="w-3.5 h-3.5 text-primary" />
                        <span className="text-xs text-gray-400 font-medium">Conversation starter</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ Looking For ═══ */}
        {lookingForDisplay && (
          <div className="mb-6">
            <h3 className="text-lg font-display font-bold text-white mb-2">Looking For</h3>
            <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-white/10 text-white font-semibold text-sm">
              <span className="text-lg">{lookingForDisplay.emoji}</span>
              {lookingForDisplay.label}
            </span>
          </div>
        )}

        {/* ═══ Photos ═══ */}
        {filledPhotos.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-display font-bold text-white mb-3">Photos</h3>
            <div className="grid grid-cols-3 gap-2">
              {filledPhotos.map((url, i) => (
                <div key={i} className="aspect-square rounded-xl overflow-hidden bg-secondary">
                  <img src={resolvePhotoUrl(url)} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ The Basics ═══ */}
        {hasBasics && (
          <div className="mb-6">
            <h3 className="text-lg font-display font-bold text-white mb-3">The Basics</h3>
            <div className="grid grid-cols-2 gap-2">
              {([
                { icon: Cake, label: "Birthday", value: profile.birthDate ? `${profile.birthDate.toLocaleDateString()} (${profile.zodiac})` : null },
                { icon: Briefcase, label: "Work", value: profile.job },
                { icon: Ruler, label: "Height", value: profile.heightCm ? `${profile.heightCm} cm` : null },
                { icon: MapPin, label: "Location", value: profile.location },
              ] as const)
                .filter((item) => item.value)
                .map((item) => (
                  <div key={item.label} className="flex items-center gap-2.5 p-3 rounded-xl bg-white/5 border border-white/10">
                    <item.icon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-500">{item.label}</p>
                      <p className="text-sm font-semibold text-white truncate">{item.value}</p>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ═══ My Vibes ═══ */}
        {profile.vibes.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-display font-bold text-white mb-3">My Vibes</h3>
            <div className="flex flex-wrap gap-2">
              {profile.vibes.map((v) => (
                <span key={v} className="px-3 py-1.5 rounded-full text-sm font-medium text-white bg-violet-500/15 border border-violet-500/35">
                  {v}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Lifestyle ═══ */}
        {hasLifestyle && (
          <div className="mb-6">
            <h3 className="text-lg font-display font-bold text-white mb-3">Lifestyle</h3>
            <LifestyleDetails values={profile.lifestyle} />
          </div>
        )}
      </div>

      {/* ═══ Fixed bottom CTA ═══ */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t border-white/5 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-violet-500 to-pink-500 text-white font-bold text-base hover:opacity-90 transition-opacity"
          >
            <Pencil className="w-4 h-4" />
            Back to editing
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default ProfilePreview;
