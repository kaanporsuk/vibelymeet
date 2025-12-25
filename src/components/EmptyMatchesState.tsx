import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Sparkles, Calendar, Video, Heart } from "lucide-react";
import { Button } from "./ui/button";

interface EmptyMatchesStateProps {
  onBrowseEvents: () => void;
}

export const EmptyMatchesState = ({ onBrowseEvents }: EmptyMatchesStateProps) => {
  const navigate = useNavigate();
  
  const features = [
    { icon: Video, text: "5-minute video dates" },
    { icon: Heart, text: "Real connections" },
    { icon: Sparkles, text: "Matched by vibes" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center py-12 px-6 text-center"
    >
      {/* Animated illustration */}
      <div className="relative mb-8">
        {/* Background glow */}
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{ duration: 3, repeat: Infinity }}
          className="absolute inset-0 bg-gradient-primary rounded-full blur-3xl"
        />
        
        {/* Main icon container */}
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="relative w-32 h-32 rounded-3xl bg-gradient-primary flex items-center justify-center"
        >
          <div className="absolute inset-[3px] rounded-3xl bg-background flex items-center justify-center">
            <div className="text-6xl">💫</div>
          </div>
        </motion.div>

        {/* Floating particles */}
        {[...Array(3)].map((_, i) => (
          <motion.div
            key={i}
            animate={{
              y: [0, -20, 0],
              x: [0, (i - 1) * 10, 0],
              opacity: [0.5, 1, 0.5],
            }}
            transition={{
              duration: 2,
              delay: i * 0.3,
              repeat: Infinity,
            }}
            className="absolute w-2 h-2 rounded-full bg-accent"
            style={{
              top: `${20 + i * 30}%`,
              left: `${i * 40}%`,
            }}
          />
        ))}
      </div>

      {/* Content */}
      <h2 className="text-2xl font-display font-bold text-foreground mb-2">
        Your vibe circle awaits
      </h2>
      <p className="text-muted-foreground mb-8 max-w-xs">
        Join a video speed dating event to meet people who match your energy. No swiping, just real conversations.
      </p>

      {/* Feature pills */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {features.map(({ icon: Icon, text }) => (
          <div
            key={text}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-card border border-border"
          >
            <Icon className="w-4 h-4 text-primary" />
            <span className="text-sm text-foreground">{text}</span>
          </div>
        ))}
      </div>

      {/* CTA Button */}
      <Button
        onClick={onBrowseEvents}
        className="bg-gradient-primary hover:opacity-90 text-primary-foreground font-semibold px-8 py-6 rounded-2xl text-lg shadow-lg"
      >
        <Calendar className="w-5 h-5 mr-2" />
        Find Your Next Event
      </Button>

      {/* Secondary link */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => navigate("/how-it-works")}
        className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        How does Vibely work? →
      </motion.button>
    </motion.div>
  );
};
