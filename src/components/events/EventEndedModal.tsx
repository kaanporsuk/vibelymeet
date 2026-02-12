import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageCircle, Home } from "lucide-react";

interface EventEndedModalProps {
  isOpen: boolean;
}

export const EventEndedModal = ({ isOpen }: EventEndedModalProps) => {
  const navigate = useNavigate();

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
        >
          <div className="absolute inset-0 bg-background/90 backdrop-blur-xl" />

          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="relative z-10 glass-card p-8 rounded-3xl text-center space-y-5 max-w-sm w-full"
          >
            <motion.div
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="text-5xl"
            >
              🎉
            </motion.div>

            <div className="space-y-2">
              <h2 className="text-xl font-display font-bold text-foreground">
                Thanks for joining!
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This event has ended 💚 Check your matches to keep the
                conversation going.
              </p>
            </div>

            <div className="space-y-3">
              <Button
                onClick={() => navigate("/matches")}
                className="w-full bg-gradient-to-r from-primary to-accent text-primary-foreground font-semibold rounded-2xl h-12"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                View Matches
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate("/dashboard")}
                className="w-full rounded-2xl h-12"
              >
                <Home className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
