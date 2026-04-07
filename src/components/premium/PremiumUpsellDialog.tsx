import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { openPremium } from "@/lib/premiumNavigation";
import type { NavigateFunction } from "react-router-dom";
import type { PremiumFunnelNavOptions } from "@shared/premiumFunnel";

type PremiumUpsellDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navigate: NavigateFunction;
  title: string;
  description: string;
  funnel: PremiumFunnelNavOptions;
  continueLabel?: string;
  /** Fired when user taps primary CTA (before navigation). */
  onContinue?: () => void;
};

/**
 * Lightweight contextual upsell; primary CTA routes to `/premium` with funnel params.
 * Expect `premium_entry_tapped` already recorded when opening from a gate (modal is step 2).
 */
export function PremiumUpsellDialog({
  open,
  onOpenChange,
  navigate,
  title,
  description,
  funnel,
  continueLabel = "View Premium plans",
  onContinue,
}: PremiumUpsellDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-left">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction
            className="w-full rounded-xl"
            onClick={() => {
              onContinue?.();
              onOpenChange(false);
              openPremium(navigate, { ...funnel, recordEntryTapped: false });
            }}
          >
            {continueLabel}
          </AlertDialogAction>
          <AlertDialogCancel className="w-full rounded-xl mt-0 border-border">Not now</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
