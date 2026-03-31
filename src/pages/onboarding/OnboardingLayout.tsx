import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";

interface OnboardingLayoutProps {
  children: React.ReactNode;
  currentStep: number;
  totalSteps: number;
  onBack?: () => void;
  showProgress?: boolean;
}

export const OnboardingLayout = ({
  children,
  currentStep,
  totalSteps,
  onBack,
  showProgress = true,
}: OnboardingLayoutProps) => {
  const progress = ((currentStep + 1) / totalSteps) * 100;

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex flex-col">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full bg-pink-500/5 blur-[100px]" />
      </div>

      {/* Top bar */}
      <div className="relative z-10 px-4 pt-4 pb-2">
        <div className="flex items-center h-10">
          {onBack ? (
            <button
              onClick={onBack}
              className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : (
            <div className="w-10" />
          )}
          {showProgress && (
            <div className="flex-1 mx-3">
              <div className="w-full h-[3px] bg-secondary rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-primary to-pink-500 rounded-full"
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>
            </div>
          )}
          <div className="w-10" />
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col overflow-y-auto">
        <div className="flex-1 flex flex-col items-center px-4 pb-8">
          <div className="w-full max-w-[420px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="flex-1"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};
