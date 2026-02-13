import { motion } from "framer-motion";
import { Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LobbyEmptyStateProps {
  onRefresh: () => void;
}

const LobbyEmptyState = ({ onRefresh }: LobbyEmptyStateProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-xs mx-auto text-center space-y-6 py-12"
    >
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/20 flex items-center justify-center"
      >
        <Sparkles className="w-9 h-9 text-primary" />
      </motion.div>

      <div className="space-y-2">
        <h3 className="text-lg font-display font-semibold text-foreground">
          You've seen everyone for now!
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          More people are joining — we'll refresh automatically.
        </p>
      </div>

      <Button variant="outline" size="sm" onClick={onRefresh} className="gap-2">
        <RefreshCw className="w-4 h-4" />
        Refresh Now
      </Button>
    </motion.div>
  );
};

export default LobbyEmptyState;
