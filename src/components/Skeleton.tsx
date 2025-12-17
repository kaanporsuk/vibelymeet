import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export const Skeleton = ({ className }: SkeletonProps) => {
  return (
    <div
      className={cn(
        "animate-pulse bg-muted rounded-lg",
        className
      )}
    />
  );
};

export const EventCardSkeleton = () => {
  return (
    <div className="glass-card overflow-hidden">
      <Skeleton className="h-40 rounded-none" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-10 w-full rounded-2xl" />
      </div>
    </div>
  );
};

export const MatchAvatarSkeleton = () => {
  return (
    <div className="flex flex-col items-center gap-2 shrink-0">
      <Skeleton className="w-16 h-16 rounded-full" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
};
