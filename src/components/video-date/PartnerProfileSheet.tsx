import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OtherUserFullProfileView } from "@/components/profile/OtherUserFullProfileView";
import { useOtherUserFullProfile } from "@/hooks/useOtherUserFullProfile";

interface PartnerProfile {
  name: string;
  age: number;
  avatarUrl?: string;
  photos?: string[];
  about_me?: string;
  job?: string;
  location?: string;
  heightCm?: number;
  tags: string[];
  prompts?: { question: string; answer: string }[];
}

interface PartnerProfileSheetProps {
  isOpen: boolean;
  onClose: () => void;
  partner: PartnerProfile;
  partnerProfileId?: string | null;
}

export const PartnerProfileSheet = ({
  isOpen,
  onClose,
  partner,
  partnerProfileId,
}: PartnerProfileSheetProps) => {
  const { data: profile, isLoading } = useOtherUserFullProfile(isOpen ? partnerProfileId : null);

  return (
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-3xl border-t border-border/50 bg-background"
          >
            <div className="flex justify-center py-3">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="absolute right-4 top-3 z-20 h-9 w-9 rounded-full bg-secondary/80"
              aria-label="Close profile"
            >
              <X className="h-4 w-4" />
            </Button>

            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex h-[65dvh] items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : profile ? (
                <OtherUserFullProfileView profile={profile} />
              ) : (
                <div className="flex h-[65dvh] flex-col items-center justify-center gap-4 px-6 text-center">
                  <p className="text-lg font-semibold text-foreground">Profile unavailable</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    {partner.name}'s profile cannot be opened right now.
                  </p>
                  <Button type="button" variant="secondary" onClick={onClose}>
                    Close
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
};
