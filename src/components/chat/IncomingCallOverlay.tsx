import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Phone, PhoneOff, Video } from "lucide-react";
import { ProfilePhoto } from "@/components/ui/ProfilePhoto";
import type { IncomingCallData } from "@/hooks/useMatchCall";

interface IncomingCallOverlayProps {
  incomingCall: IncomingCallData;
  onAnswer: () => void;
  onDecline: () => void;
  onTimeout: () => void;
}

export const IncomingCallOverlay = ({
  incomingCall,
  onAnswer,
  onDecline,
  onTimeout,
}: IncomingCallOverlayProps) => {
  const [autoTimeout, setAutoTimeout] = useState(30);
  const onTimeoutRef = useRef(onTimeout);
  const timeoutFiredRef = useRef(false);

  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    setAutoTimeout(30);
    timeoutFiredRef.current = false;
  }, [incomingCall.callId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setAutoTimeout((p) => {
        if (p <= 1) {
          if (!timeoutFiredRef.current) {
            timeoutFiredRef.current = true;
            onTimeoutRef.current();
          }
          return 0;
        }
        return p - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [incomingCall.callId]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-xl"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        className="flex flex-col items-center gap-6 p-8"
      >
        {/* Pulsing ring */}
        <div className="relative">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute inset-0 rounded-full border-2 border-primary/30"
              animate={{ scale: [1, 1.8, 2.2], opacity: [0.6, 0.2, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }}
              style={{ width: 96, height: 96, top: -8, left: -8 }}
            />
          ))}
          <ProfilePhoto name={incomingCall.callerName} size="lg" rounded="full" className="w-20 h-20" />
        </div>

        <div className="text-center space-y-1">
          <h2 className="text-xl font-display font-bold text-foreground">{incomingCall.callerName}</h2>
          <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
            {incomingCall.callType === "video" ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
            Incoming {incomingCall.callType} call...
          </p>
        </div>

        <div className="flex items-center gap-8 mt-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onDecline}
            className="w-16 h-16 rounded-full bg-destructive flex items-center justify-center shadow-lg"
          >
            <PhoneOff className="w-7 h-7 text-destructive-foreground" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onAnswer}
            className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center shadow-lg"
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <Phone className="w-7 h-7 text-white" />
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};
