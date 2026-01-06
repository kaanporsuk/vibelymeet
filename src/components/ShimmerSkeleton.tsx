import { cn } from "@/lib/utils";

interface ShimmerSkeletonProps {
  className?: string;
  variant?: "default" | "circular" | "text" | "card";
}

export const ShimmerSkeleton = ({ 
  className, 
  variant = "default" 
}: ShimmerSkeletonProps) => {
  const variantClasses = {
    default: "rounded-lg",
    circular: "rounded-full",
    text: "rounded h-4",
    card: "rounded-2xl",
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-muted",
        variantClasses[variant],
        className
      )}
    >
      <div className="absolute inset-0 shimmer-effect" />
    </div>
  );
};

// Preset skeleton components for common use cases
export const MatchCardSkeleton = () => (
  <div className="flex items-center gap-4 p-4">
    <ShimmerSkeleton variant="circular" className="w-14 h-14" />
    <div className="flex-1 space-y-2">
      <ShimmerSkeleton className="h-5 w-32" />
      <ShimmerSkeleton className="h-4 w-48" />
      <div className="flex gap-2">
        <ShimmerSkeleton className="h-5 w-16 rounded-full" />
        <ShimmerSkeleton className="h-5 w-16 rounded-full" />
      </div>
    </div>
    <ShimmerSkeleton className="h-4 w-12" />
  </div>
);

export const NewVibesRailSkeleton = () => (
  <div className="glass-card p-4 rounded-2xl mx-4">
    <div className="flex items-center gap-2 mb-4">
      <ShimmerSkeleton variant="circular" className="w-8 h-8" />
      <div className="space-y-1">
        <ShimmerSkeleton className="h-4 w-20" />
        <ShimmerSkeleton className="h-3 w-24" />
      </div>
    </div>
    <div className="flex gap-4 overflow-hidden">
      {Array(4).fill(0).map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-2">
          <ShimmerSkeleton variant="circular" className="w-20 h-20" />
          <ShimmerSkeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  </div>
);

export const EventCardSkeleton = () => (
  <div className="w-[280px] flex-shrink-0">
    <ShimmerSkeleton variant="card" className="w-full h-[260px]" />
  </div>
);

export const FeaturedEventSkeleton = () => (
  <ShimmerSkeleton variant="card" className="w-full h-[420px]" />
);

export const EventsRailSkeleton = () => (
  <div className="space-y-4">
    <ShimmerSkeleton className="h-8 w-48 ml-4" />
    <div className="flex gap-4 overflow-hidden px-4">
      {Array(3).fill(0).map((_, i) => (
        <EventCardSkeleton key={i} />
      ))}
    </div>
  </div>
);

export const ChatMessageSkeleton = ({ isOwn = false }: { isOwn?: boolean }) => (
  <div className={cn("flex gap-2 px-4", isOwn ? "justify-end" : "justify-start")}>
    {!isOwn && <ShimmerSkeleton variant="circular" className="w-8 h-8" />}
    <div className="space-y-1">
      <ShimmerSkeleton 
        className={cn(
          "h-12 w-48",
          isOwn ? "rounded-2xl rounded-br-sm" : "rounded-2xl rounded-bl-sm"
        )} 
      />
      <ShimmerSkeleton className="h-3 w-16" />
    </div>
  </div>
);

export const ProfileCardSkeleton = () => (
  <div className="glass-card rounded-2xl overflow-hidden">
    <ShimmerSkeleton className="w-full aspect-[3/4]" />
    <div className="p-4 space-y-3">
      <ShimmerSkeleton className="h-6 w-40" />
      <ShimmerSkeleton className="h-4 w-24" />
      <div className="flex gap-2">
        <ShimmerSkeleton className="h-6 w-20 rounded-full" />
        <ShimmerSkeleton className="h-6 w-20 rounded-full" />
        <ShimmerSkeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  </div>
);
