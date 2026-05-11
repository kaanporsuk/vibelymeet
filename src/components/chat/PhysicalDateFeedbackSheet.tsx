import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  submitDatePlanFeedback,
  type SubmitDatePlanFeedbackInput,
} from "@/hooks/useDatePlanFeedback";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type PhysicalDateFeedbackSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  partnerName: string;
  onSubmitted: (result: { report_requested?: boolean }) => void;
};

type Option<T extends string> = { value: T; label: string };
type WouldMeetAgainValue = "yes" | "maybe" | "no";
type ProfileAccurateValue = "yes" | "somewhat" | "no";

const didMeetOptions: Option<SubmitDatePlanFeedbackInput["didMeet"]>[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const feltSafeOptions: Option<SubmitDatePlanFeedbackInput["feltSafe"]>[] = [
  { value: "yes", label: "Yes" },
  { value: "not_really", label: "Not really" },
  { value: "report", label: "I want to report something" },
];

const wouldMeetOptions: Option<WouldMeetAgainValue>[] = [
  { value: "yes", label: "Yes" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
];

const profileAccurateOptions: Option<ProfileAccurateValue>[] = [
  { value: "yes", label: "Yes" },
  { value: "somewhat", label: "Somewhat" },
  { value: "no", label: "No" },
];

function OptionGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              value === option.value
                ? "border-primary bg-primary/15 text-primary"
                : "border-border/60 bg-muted/20 text-foreground hover:bg-muted/40",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PhysicalDateFeedbackSheet({
  isOpen,
  onClose,
  planId,
  partnerName,
  onSubmitted,
}: PhysicalDateFeedbackSheetProps) {
  const [didMeet, setDidMeet] = useState<SubmitDatePlanFeedbackInput["didMeet"] | null>(null);
  const [feltSafe, setFeltSafe] = useState<SubmitDatePlanFeedbackInput["feltSafe"] | null>(null);
  const [wouldMeetAgain, setWouldMeetAgain] = useState<WouldMeetAgainValue | null>(null);
  const [profileAccurate, setProfileAccurate] = useState<ProfileAccurateValue | null>(null);
  const [freeText, setFreeText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = Boolean(didMeet && feltSafe && !isSubmitting);

  const handleSubmit = async () => {
    if (!didMeet || !feltSafe || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await submitDatePlanFeedback({
        planId,
        didMeet,
        feltSafe,
        wouldMeetAgain,
        profileAccurate,
        freeText,
      });
      toast.success("Thanks for sharing.");
      onSubmitted({ report_requested: result.report_requested === true });
      onClose();
    } catch {
      toast.error("Could not save feedback");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border/60 bg-background p-5 shadow-2xl sm:rounded-3xl"
            initial={{ y: 32, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 32, opacity: 0 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">How did the date go?</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Private feedback about your date with {partnerName}. Your match will not see this.
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close feedback sheet">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-5">
              <OptionGroup<SubmitDatePlanFeedbackInput["didMeet"]>
                label="Did you meet?"
                value={didMeet}
                options={didMeetOptions}
                onChange={setDidMeet}
              />
              <OptionGroup<SubmitDatePlanFeedbackInput["feltSafe"]>
                label="Did you feel safe?"
                value={feltSafe}
                options={feltSafeOptions}
                onChange={setFeltSafe}
              />
              {feltSafe === "report" ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-foreground">
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    Report this date
                  </div>
                  <p className="mb-3 text-muted-foreground">
                    Your survey will flag this date for safety review. You can also contact Vibely Safety now.
                  </p>
                  <Button asChild variant="outline" size="sm">
                    <a href="mailto:safety@vibelymeet.com?subject=Report%20this%20date">
                      Report this date
                    </a>
                  </Button>
                </div>
              ) : null}
              <OptionGroup<WouldMeetAgainValue>
                label="Would you meet this person again?"
                value={wouldMeetAgain}
                options={wouldMeetOptions}
                onChange={setWouldMeetAgain}
              />
              <OptionGroup<ProfileAccurateValue>
                label="Was their profile accurate?"
                value={profileAccurate}
                options={profileAccurateOptions}
                onChange={setProfileAccurate}
              />
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Anything Vibely should know?</p>
                <Textarea
                  value={freeText}
                  onChange={(event) => setFreeText(event.target.value)}
                  placeholder="Optional"
                  className="min-h-[100px] resize-none"
                  maxLength={2000}
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <Button type="button" className="flex-1" onClick={() => void handleSubmit()} disabled={!canSubmit}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit feedback
              </Button>
              <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
                Skip
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
