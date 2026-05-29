import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { OtherUserFullProfileView } from "@/components/profile/OtherUserFullProfileView";
import { Button } from "@/components/ui/button";
import { useUserProfile as useViewerProfile } from "@/contexts/AuthContext";
import { useOtherUserFullProfile } from "@/hooks/useOtherUserFullProfile";

const ProfilePreview = () => {
  const navigate = useNavigate();
  const { user } = useViewerProfile();
  const profileId = user?.id ?? null;
  const { data: profile, isLoading, refetch } = useOtherUserFullProfile(profileId);
  const [hasFreshPreview, setHasFreshPreview] = useState(false);
  const [freshPreviewFailed, setFreshPreviewFailed] = useState(false);
  const refetchRequestIdRef = useRef(0);
  const previewProfile = profile?.id === profileId ? profile : null;

  const handleClose = () => navigate(-1);

  useEffect(() => {
    const requestId = refetchRequestIdRef.current + 1;
    refetchRequestIdRef.current = requestId;
    setHasFreshPreview(false);
    setFreshPreviewFailed(false);
    if (!profileId) return;
    void refetch()
      .then((result) => {
        if (refetchRequestIdRef.current !== requestId) return;
        setFreshPreviewFailed(result.isError || result.data?.id !== profileId);
        setHasFreshPreview(true);
      })
      .catch(() => {
        if (refetchRequestIdRef.current !== requestId) return;
        setFreshPreviewFailed(true);
        setHasFreshPreview(true);
      });
    return () => {
      refetchRequestIdRef.current += 1;
    };
  }, [profileId, refetch]);

  if (!profileId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card/70 p-6 text-center">
          <p className="text-lg font-semibold text-foreground">Sign in required</p>
          <p className="mt-2 text-sm text-muted-foreground">Log in to preview your public profile.</p>
          <Button type="button" onClick={handleClose} className="mt-5">
            Go back
          </Button>
        </div>
      </div>
    );
  }

  if ((isLoading && !previewProfile) || (!hasFreshPreview && !previewProfile)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!previewProfile) {
    const message = freshPreviewFailed
      ? "Your public profile could not be refreshed right now."
      : "Your public profile could not be opened right now.";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card/70 p-6 text-center">
          <p className="text-lg font-semibold text-foreground">Profile preview unavailable</p>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          <Button type="button" onClick={handleClose} className="mt-5">
            Go back
          </Button>
        </div>
      </div>
    );
  }

  return <OtherUserFullProfileView profile={previewProfile} onClose={handleClose} />;
};

export default ProfilePreview;
