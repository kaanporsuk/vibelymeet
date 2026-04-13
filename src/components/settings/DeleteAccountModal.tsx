import { useState } from "react";
import { AlertTriangle, Loader2, ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";

interface DeleteAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string | null) => Promise<void>;
  isDeleting: boolean;
}

const DELETION_REASONS = [
  { value: "found_someone", label: "I found someone 🎉" },
  { value: "not_enough_events", label: "Not enough events in my city" },
  { value: "technical_issues", label: "Technical issues" },
  { value: "privacy_concerns", label: "Privacy concerns" },
  { value: "taking_break", label: "Taking a break" },
  { value: "other", label: "Other" },
];

export const DeleteAccountModal = ({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: DeleteAccountModalProps) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reason, setReason] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const isConfirmEnabled = confirmText === "DELETE";

  const handleClose = () => {
    if (!isDeleting) {
      setStep(1);
      setReason(null);
      setConfirmText("");
      onOpenChange(false);
    }
  };

  const handleConfirm = async () => {
    if (isConfirmEnabled && !isDeleting) {
      await onConfirm(reason);
    }
  };

  return (
    <Drawer open={open} onOpenChange={handleClose}>
      <DrawerContent className="max-h-[90vh]">
        {/* Step 1: Warning */}
        {step === 1 && (
          <div className="px-6 pb-8">
            <DrawerHeader className="px-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-destructive" />
              </div>
              <DrawerTitle className="text-xl">Delete your account?</DrawerTitle>
              </div>
              <DrawerDescription className="text-left">
                This starts a scheduled deletion request. You keep access during the grace window, and final cleanup begins only if you do not cancel before the scheduled date.
              </DrawerDescription>
            </DrawerHeader>

            <div className="space-y-4 mb-6">
              <p className="text-sm font-medium text-foreground">What gets deleted:</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                  Your profile, vibe video, and profile photos after the grace window ends
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                  Your access to matches and conversations
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                  Shared chat media only after nobody still retains the conversation
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                  Your credits and subscription
                </li>
              </ul>
            </div>

            <div className="flex flex-col gap-3">
              <Button variant="gradient" className="w-full" onClick={handleClose}>
                Keep My Account
              </Button>
              <Button
                variant="ghost"
                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setStep(2)}
              >
                Continue to Delete
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Reason */}
        {step === 2 && (
          <div className="px-6 pb-8">
            <DrawerHeader className="px-0">
              <DrawerTitle className="text-xl">Before you go...</DrawerTitle>
              <DrawerDescription className="text-left">
                Help us improve (optional)
              </DrawerDescription>
            </DrawerHeader>

            <RadioGroup
              value={reason || ""}
              onValueChange={setReason}
              className="space-y-3 mb-6"
            >
              {DELETION_REASONS.map((r) => (
                <label
                  key={r.value}
                  className="flex items-center gap-3 p-3 rounded-xl bg-secondary/40 cursor-pointer hover:bg-secondary/60 transition-colors"
                >
                  <RadioGroupItem value={r.value} id={r.value} />
                  <Label htmlFor={r.value} className="cursor-pointer text-sm font-medium text-foreground">
                    {r.label}
                  </Label>
                </label>
              ))}
            </RadioGroup>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                variant="ghost"
                className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setStep(3)}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Final Confirmation */}
        {step === 3 && (
          <div className="px-6 pb-8">
            <DrawerHeader className="px-0">
              <DrawerTitle className="text-xl">Type DELETE to confirm</DrawerTitle>
              <DrawerDescription className="text-left">
                This starts a deletion grace window of about 30 days. You can cancel before the scheduled date and keep your account.
              </DrawerDescription>
            </DrawerHeader>

            <div className="space-y-4 mb-6">
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                placeholder="Type DELETE"
                className="font-mono text-center text-lg"
                disabled={isDeleting}
                autoComplete="off"
              />
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={handleClose} disabled={isDeleting}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1 gap-2"
                onClick={handleConfirm}
                disabled={!isConfirmEnabled || isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Scheduling...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Schedule Deletion
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
};
