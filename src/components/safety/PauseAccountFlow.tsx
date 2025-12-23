import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Moon, Clock, Infinity, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

interface PauseAccountFlowProps {
  onBack: () => void;
  onComplete: () => void;
}

type PauseDuration = "day" | "week" | "indefinite";

const pauseOptions = [
  {
    id: "day" as PauseDuration,
    icon: Clock,
    label: "24 Hours",
    description: "Take a quick breather",
  },
  {
    id: "week" as PauseDuration,
    icon: Moon,
    label: "1 Week",
    description: "A short vibe break",
  },
  {
    id: "indefinite" as PauseDuration,
    icon: Infinity,
    label: "Indefinite",
    description: "Until you're ready to return",
  },
];

const PauseAccountFlow = ({ onBack, onComplete }: PauseAccountFlowProps) => {
  const { pauseAccount, user } = useAuth();
  const [selectedDuration, setSelectedDuration] = useState<PauseDuration | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handlePause = () => {
    if (!selectedDuration) return;
    pauseAccount(selectedDuration);
    setIsSuccess(true);
  };

  if (isSuccess) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-6 py-12 text-center space-y-6"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className="relative w-24 h-24 mx-auto"
        >
          {/* Avatar with snooze overlay */}
          <img
            src={user?.avatarUrl || "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100"}
            alt="Profile"
            className="w-24 h-24 rounded-full object-cover opacity-50"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-blue-500/80 flex items-center justify-center">
              <Moon className="w-6 h-6 text-white" />
            </div>
          </div>
        </motion.div>

        <div className="space-y-2">
          <h3 className="text-2xl font-display font-bold text-foreground">
            Taking a Vibe Break
          </h3>
          <p className="text-muted-foreground">
            Your profile is now hidden from the Guest List.
            <br />
            But don't worry — your matches are safe.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-blue-500/20">
          <div className="flex items-center justify-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-blue-400" />
            <p className="text-sm text-foreground">
              {selectedDuration === "day"
                ? "Resuming in 24 hours"
                : selectedDuration === "week"
                ? "Resuming in 7 days"
                : "Paused until you return"}
            </p>
          </div>
        </div>

        <Button variant="ghost" onClick={onComplete}>
          Got it
        </Button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 p-6 pb-4 bg-card border-b border-border/50">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-full bg-secondary/50 flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-display font-bold text-foreground">
              Take a Vibe Break
            </h2>
            <p className="text-sm text-muted-foreground">
              Pause your profile temporarily
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mb-4">
            <Moon className="w-8 h-8 text-blue-400" />
          </div>
          <h3 className="font-semibold text-foreground">Need a break?</h3>
          <p className="text-sm text-muted-foreground">
            Your profile will be hidden from the Guest List, but you'll keep all your matches and conversations.
          </p>
        </div>

        <div className="space-y-3">
          {pauseOptions.map((option) => (
            <motion.button
              key={option.id}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => setSelectedDuration(option.id)}
              className={`w-full p-4 rounded-xl text-left transition-all flex items-center gap-4 ${
                selectedDuration === option.id
                  ? "bg-gradient-to-r from-blue-500/20 to-indigo-500/20 border-2 border-blue-500"
                  : "bg-secondary/30 border-2 border-transparent hover:border-border"
              }`}
            >
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  selectedDuration === option.id
                    ? "bg-blue-500/30"
                    : "bg-secondary"
                }`}
              >
                <option.icon
                  className={`w-6 h-6 ${
                    selectedDuration === option.id
                      ? "text-blue-400"
                      : "text-muted-foreground"
                  }`}
                />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">{option.label}</p>
                <p className="text-sm text-muted-foreground">{option.description}</p>
              </div>
              <div
                className={`w-5 h-5 rounded-full border-2 transition-all ${
                  selectedDuration === option.id
                    ? "border-blue-500 bg-blue-500"
                    : "border-muted-foreground"
                }`}
              >
                {selectedDuration === option.id && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-full h-full flex items-center justify-center"
                  >
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </motion.div>
                )}
              </div>
            </motion.button>
          ))}
        </div>

        <Button
          variant="gradient"
          className="w-full bg-gradient-to-r from-blue-500 to-indigo-500"
          disabled={!selectedDuration}
          onClick={handlePause}
        >
          Start My Break
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          You can resume your profile anytime from Settings
        </p>
      </div>
    </motion.div>
  );
};

export default PauseAccountFlow;
