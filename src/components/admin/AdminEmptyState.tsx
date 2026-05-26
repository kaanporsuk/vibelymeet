import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type AdminEmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "danger";
};

const AdminEmptyState = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  tone = "neutral",
}: AdminEmptyStateProps) => {
  const iconClassName = tone === "danger" ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary/60">
        <Icon className={`h-6 w-6 ${iconClassName}`} aria-hidden="true" />
      </div>
      <p className="font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {actionLabel && onAction ? (
        <Button type="button" variant="outline" size="sm" onClick={onAction} className="mt-4">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
};

export default AdminEmptyState;
