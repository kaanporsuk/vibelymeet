import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Flag, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { OtherUserFullProfileView } from "@/components/profile/OtherUserFullProfileView";
import ReportWizard from "@/components/safety/ReportWizard";
import { useUserProfile } from "@/contexts/AuthContext";
import { useBlockUser } from "@/hooks/useBlockUser";
import { useOtherUserFullProfile } from "@/hooks/useOtherUserFullProfile";

const UserProfile = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const { data: profile, isLoading } = useOtherUserFullProfile(userId ?? null);
  const { blockUserAsync, isBlocking } = useBlockUser();
  const [showReportSheet, setShowReportSheet] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);

  const displayName = profile?.name?.trim() || "this person";
  const isSelf = !!profile?.id && !!user?.id && profile.id === user.id;

  const handleBlock = useCallback(
    async (reason?: string) => {
      if (!profile || isSelf) return;
      try {
        await blockUserAsync(profile.id, displayName, reason);
        setShowBlockDialog(false);
        navigate(-1);
      } catch {
        // useBlockUser already shows the failure toast; keep the dialog open for retry.
      }
    },
    [blockUserAsync, displayName, isSelf, navigate, profile],
  );

  const handleReportComplete = useCallback(() => {
    setShowReportSheet(false);
    navigate(-1);
  }, [navigate]);

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

  return (
    <>
      <OtherUserFullProfileView
        profile={profile}
        onClose={() => navigate(-1)}
        actions={
          isSelf ? null : (
            <div className="mx-auto flex w-full max-w-4xl gap-3 px-4 sm:px-6 lg:px-8">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 flex-1 gap-2"
                onClick={() => setShowReportSheet(true)}
              >
                <Flag className="h-4 w-4" aria-hidden />
                Report
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="min-h-11 flex-1 gap-2"
                onClick={() => setShowBlockDialog(true)}
                disabled={isBlocking}
              >
                <ShieldAlert className="h-4 w-4" aria-hidden />
                Block
              </Button>
            </div>
          )
        }
      />

      <BlockUserDialog
        isOpen={showBlockDialog}
        onClose={() => setShowBlockDialog(false)}
        onConfirm={(reason) => {
          void handleBlock(reason);
        }}
        userName={displayName}
        userAvatar={profile.avatarUrl ?? undefined}
        isLoading={isBlocking}
      />

      <Sheet open={showReportSheet} onOpenChange={setShowReportSheet}>
        <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Report {displayName}</SheetTitle>
          </SheetHeader>
          <ReportWizard
            onBack={() => setShowReportSheet(false)}
            onComplete={handleReportComplete}
            preSelectedUser={{
              id: profile.id,
              name: displayName,
              avatar_url: profile.avatarUrl ?? undefined,
              interactionType: "Event Lobby",
              interactionDate: "Recent",
              reportedHasVibeVideo:
                !!profile.vibeVideo.uid?.trim() ||
                !!profile.vibeVideo.playbackRef?.trim(),
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
};

export default UserProfile;
