import { CalendarDays } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ActiveDateSuggestionWarningDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ActiveDateSuggestionWarningDialog({
  open,
  onOpenChange,
}: ActiveDateSuggestionWarningDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm rounded-2xl border-border/60 bg-background">
        <AlertDialogHeader className="items-start text-left">
          <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-full border border-primary/35 bg-primary/15 text-primary">
            <CalendarDays className="h-4 w-4" aria-hidden />
          </div>
          <AlertDialogTitle>Date suggestion already active</AlertDialogTitle>
          <AlertDialogDescription className="text-left leading-relaxed">
            You already have a live date suggestion in this chat. Use the card in the conversation to continue, respond, or cancel it before starting a new one.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction className="w-full">Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
