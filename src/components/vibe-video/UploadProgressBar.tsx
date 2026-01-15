import { motion } from "framer-motion";
import { Upload, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadProgressBarProps {
  progress: number;
  status: string;
  isComplete?: boolean;
}

export const UploadProgressBar = ({
  progress,
  status,
  isComplete = false,
}: UploadProgressBarProps) => {
  return (
    <div className="w-full max-w-xs space-y-3">
      {/* Icon */}
      <div className="flex justify-center">
        {isComplete ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center"
          >
            <Check className="w-8 h-8 text-green-500" />
          </motion.div>
        ) : (
          <div className="relative w-16 h-16">
            {/* Circular progress */}
            <svg className="w-full h-full -rotate-90">
              <circle
                cx="32"
                cy="32"
                r="28"
                stroke="hsl(var(--muted))"
                strokeWidth="4"
                fill="none"
              />
              <motion.circle
                cx="32"
                cy="32"
                r="28"
                stroke="hsl(var(--primary))"
                strokeWidth="4"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={176}
                initial={{ strokeDashoffset: 176 }}
                animate={{ strokeDashoffset: 176 - (progress / 100) * 176 }}
                transition={{ duration: 0.3 }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Upload className="w-6 h-6 text-primary" />
            </div>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <motion.div
            className={cn(
              "h-full rounded-full",
              isComplete ? "bg-green-500" : "bg-primary"
            )}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
        
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-2">
            {!isComplete && <Loader2 className="w-3 h-3 animate-spin" />}
            {status}
          </span>
          <span className={cn(
            "font-medium",
            isComplete ? "text-green-500" : "text-foreground"
          )}>
            {Math.round(progress)}%
          </span>
        </div>
      </div>
    </div>
  );
};

export default UploadProgressBar;
