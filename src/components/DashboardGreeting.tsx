import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchMyProfile, type ProfileData } from "@/services/profileService";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export const DashboardGreeting = () => {
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

  return (
    <div>
      <p className="text-sm text-muted-foreground">{getGreeting()},</p>
      <h1 className="text-xl font-display font-bold text-foreground">{firstName}</h1>
    </div>
  );
};
