import { useState, useRef, useCallback, ReactNode } from "react";
import { motion, useMotionValue, useTransform, AnimatePresence } from "framer-motion";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { cn } from "@/lib/utils";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  threshold?: number;
}

export const PullToRefresh = ({
  onRefresh,
  children,
  className,
  disabled = false,
  threshold = 80,
}: PullToRefreshProps) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const { hapticTap, hapticSuccess } = useSoundEffects();
  
  const pullDistance = useMotionValue(0);
  const pullProgress = useTransform(pullDistance, [0, threshold], [0, 1]);
  const spinRotation = useTransform(pullDistance, [0, threshold], [0, 360]);
  const indicatorOpacity = useTransform(pullDistance, [0, 20], [0, 1]);
  const indicatorScale = useTransform(pullDistance, [0, threshold], [0.5, 1]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled || isRefreshing) return;
    
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    if (scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  }, [disabled, isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling || disabled || isRefreshing) return;
    
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    if (scrollTop > 0) {
      setIsPulling(false);
      pullDistance.set(0);
      return;
    }
    
    const currentY = e.touches[0].clientY;
    const diff = Math.max(0, (currentY - startY.current) * 0.5); // Resistance factor
    
    pullDistance.set(Math.min(diff, threshold * 1.5));
    
    // Haptic feedback when reaching threshold
    if (diff >= threshold && pullDistance.get() < threshold) {
      hapticTap();
    }
  }, [isPulling, disabled, isRefreshing, pullDistance, threshold, hapticTap]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling || disabled) return;
    
    const currentPull = pullDistance.get();
    
    if (currentPull >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      hapticSuccess();
      
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }
    
    setIsPulling(false);
    pullDistance.set(0);
  }, [isPulling, disabled, pullDistance, threshold, isRefreshing, onRefresh, hapticSuccess]);

  return (
    <div className={cn("relative overflow-x-hidden", className)}>
      {/* Pull indicator */}
      <AnimatePresence>
        {(isPulling || isRefreshing) && (
          <motion.div
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
            className="absolute top-0 left-0 right-0 z-50 flex justify-center pt-4 pointer-events-none"
          >
            <motion.div
              style={{ 
                opacity: indicatorOpacity,
                scale: indicatorScale,
              }}
              className="relative"
            >
              <RefreshIndicator 
                isRefreshing={isRefreshing}
                pullProgress={pullProgress}
                spinRotation={spinRotation}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <motion.div
        ref={containerRef}
        style={{ 
          y: useTransform(pullDistance, [0, threshold * 1.5], [0, 60]),
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </motion.div>
    </div>
  );
};

// Custom animated refresh indicator
const RefreshIndicator = ({
  isRefreshing,
  pullProgress,
  spinRotation,
}: {
  isRefreshing: boolean;
  pullProgress: any;
  spinRotation: any;
}) => {
  return (
    <div className="w-12 h-12 rounded-full bg-card border border-border shadow-lg flex items-center justify-center">
      {isRefreshing ? (
        // Spinning loader
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ 
            duration: 1, 
            repeat: Infinity, 
            ease: "linear" 
          }}
          className="relative w-6 h-6"
        >
          {/* Outer ring */}
          <svg className="w-6 h-6" viewBox="0 0 24 24">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="hsl(var(--primary) / 0.3)"
              strokeWidth="3"
              fill="none"
            />
            <motion.circle
              cx="12"
              cy="12"
              r="10"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="63"
              strokeDashoffset="47"
            />
          </svg>
          
          {/* Inner pulse */}
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.5, 1, 0.5],
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
            }}
            className="absolute inset-2 rounded-full bg-primary/20"
          />
        </motion.div>
      ) : (
        // Pull progress indicator
        <motion.div
          style={{ rotate: spinRotation }}
          className="relative w-6 h-6"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="hsl(var(--muted))"
              strokeWidth="3"
              fill="none"
            />
            <motion.circle
              cx="12"
              cy="12"
              r="10"
              stroke="hsl(var(--primary))"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="63"
              style={{
                strokeDashoffset: useTransform(pullProgress, [0, 1], [63, 0]),
              }}
            />
          </svg>
          
          {/* Arrow icon */}
          <motion.div
            style={{
              opacity: useTransform(pullProgress, [0.8, 1], [0, 1]),
              scale: useTransform(pullProgress, [0.8, 1], [0.5, 1]),
            }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <svg 
              className="w-3 h-3 text-primary" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
};

export default PullToRefresh;
