import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WifiOff, Wifi } from "lucide-react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

export const OfflineBanner = () => {
  const { isOnline } = useNetworkStatus();
  const [showReconnected, setShowReconnected] = useState(false);
  const [hasBeenOffline, setHasBeenOffline] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setHasBeenOffline(true);
    } else if (hasBeenOffline) {
      setShowReconnected(true);
      const timer = setTimeout(() => setShowReconnected(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, hasBeenOffline]);

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          key="offline"
          initial={{ y: -60 }}
          animate={{ y: 0 }}
          exit={{ y: -60 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed top-0 left-0 right-0 z-[100] bg-destructive/95 backdrop-blur-md py-3 text-center"
        >
          <div className="flex items-center justify-center gap-2 text-destructive-foreground">
            <WifiOff className="w-4 h-4" />
            <div>
              <p className="text-sm font-semibold">You're offline</p>
              <p className="text-xs opacity-80">Check your connection</p>
            </div>
          </div>
        </motion.div>
      )}
      {showReconnected && isOnline && (
        <motion.div
          key="reconnected"
          initial={{ y: -60 }}
          animate={{ y: 0 }}
          exit={{ y: -60 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed top-0 left-0 right-0 z-[100] bg-green-600/95 backdrop-blur-md py-3 text-center"
        >
          <div className="flex items-center justify-center gap-2 text-white">
            <Wifi className="w-4 h-4" />
            <p className="text-sm font-semibold">Back online</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
