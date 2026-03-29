import { cn } from "@/lib/utils";

const ROWS: { align: "start" | "end"; width: string }[] = [
  { align: "start", width: "w-[72%] max-w-sm" },
  { align: "end", width: "w-[58%] max-w-xs" },
  { align: "start", width: "w-[64%] max-w-sm" },
  { align: "end", width: "w-[48%] max-w-xs" },
  { align: "start", width: "w-[78%] max-w-sm" },
  { align: "end", width: "w-[52%] max-w-xs" },
];

/**
 * Staged thread placeholder while messages load — keeps vertical rhythm close to real bubbles.
 */
export function ChatThreadSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex flex-col gap-2.5 pt-1 pb-4", className)}
      aria-busy
      aria-label="Loading messages"
    >
      {ROWS.map((row, i) => (
        <div
          key={i}
          className={cn("flex w-full", row.align === "end" ? "justify-end" : "justify-start")}
        >
          <div
            className={cn(
              "h-10 rounded-2xl bg-muted/45 dark:bg-muted/35 animate-pulse",
              row.width,
            )}
          />
        </div>
      ))}
    </div>
  );
}
