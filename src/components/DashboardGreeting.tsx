import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight } from "lucide-react";
import { fetchMyProfile, type ProfileData } from "@/services/profileService";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function calculateCompleteness(profile: ProfileData): number {
  const relationshipIntent = profile.relationshipIntent ?? profile.lookingFor;
  const checks = [
    !!profile.name,
    (profile.photos?.length || 0) >= 1,
    (profile.photos?.length || 0) >= 3,
    !!profile.aboutMe,
    !!profile.job,
    !!profile.location,
    (profile.vibes?.length || 0) >= 1,
    (profile.prompts?.length || 0) >= 1,
    !!relationshipIntent,
    !!profile.tagline,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export const DashboardGreeting = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await fetchMyProfile();
        setProfile(data);
      } catch (error) {
        console.error("Error loading profile for greeting:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-1">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-6 w-24" />
      </div>
    );
  }

  const firstName = profile?.name?.split(" ")[0] || "Viber";
  const completeness = profile ? calculateCompleteness(profile) : 100;

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm text-muted-foreground">{getGreeting()},</p>
        <h1 className="text-xl font-display font-bold text-foreground">{firstName}</h1>
      </div>
      {completeness < 80 && (
        <button
          onClick={() => navigate("/profile")}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-xs text-accent hover:bg-accent/20 transition-colors"
        >
          Complete your profile for better matches
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};
