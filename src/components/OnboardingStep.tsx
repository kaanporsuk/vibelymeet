import { motion, AnimatePresence } from "framer-motion";
import { ReactNode } from "react";

interface OnboardingStepProps {
  children: ReactNode;
  isActive: boolean;
}

export const OnboardingStep = ({ children, isActive }: OnboardingStepProps) => {
  return (
    <AnimatePresence mode="wait">
      {isActive && (
        <motion.div
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -50 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className="w-full"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
