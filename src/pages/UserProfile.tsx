import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtherUserFullProfileView } from "@/components/profile/OtherUserFullProfileView";
import { useOtherUserFullProfile } from "@/hooks/useOtherUserFullProfile";

const UserProfile = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { data: profile, isLoading } = useOtherUserFullProfile(userId ?? null);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card/70 p-6 text-center">
          <p className="text-lg font-semibold text-foreground">Profile not found</p>
          <p className="mt-2 text-sm text-muted-foreground">This profile is unavailable right now.</p>
          <Button type="button" onClick={() => navigate(-1)} className="mt-5">
            Go back
          </Button>
        </div>
      </div>
    );
  }

  return <OtherUserFullProfileView profile={profile} onClose={() => navigate(-1)} />;
};

export default UserProfile;
