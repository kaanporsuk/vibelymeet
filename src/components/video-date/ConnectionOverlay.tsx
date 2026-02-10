import { motion } from "framer-motion";
import { Loader2, ArrowLeft, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConnectionOverlayProps {
  isConnecting: boolean;
  onLeave: () => void;
}

export const ConnectionOverlay = ({
  isConnecting,
  onLeave,
}: ConnectionOverlayProps) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur-md z-50"
    >
      <div className="text-center space-y-6 px-8 max-w-xs">
        {/* Animated rings */}
        <div className="relative w-24 h-24 mx-auto">
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-primary/30"
            animate={{ scale: [1, 1.5, 1.5], opacity: [0.6, 0, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-primary/30"
            animate={{ scale: [1, 1.5, 1.5], opacity: [0.6, 0, 0] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeOut",
              delay: 0.6,
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
              {isConnecting ? (
                <Loader2 className="w-7 h-7 animate-spin text-primary" />
              ) : (
                <Wifi className="w-7 h-7 text-primary" />
              )}
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-display font-semibold text-lg text-foreground mb-1">
            {isConnecting ? "Connecting..." : "Waiting for partner"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isConnecting
              ? "Setting up your video date"
              : "Your date will start as soon as they join"}
          </p>
        </div>

        <Button
          variant="outline"
          onClick={onLeave}
          className="rounded-full px-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Leave
        </Button>
      </div>
    </motion.div>
  );
};
