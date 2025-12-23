import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, MessageCircle, MapPin, Users, Video, Shield, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SafetyTipsCarouselProps {
  onBack: () => void;
}

const safetyTips = [
  {
    icon: MessageCircle,
    title: "Keep it on the app",
    description: "Keep conversations on Vibely until you're comfortable. Our chat is encrypted and can be reviewed if there's an issue.",
    color: "from-violet-500/20 to-purple-500/20",
    iconColor: "text-violet-400",
  },
  {
    icon: Users,
    title: "Video before you meet",
    description: "Use our video dates to verify your match is who they say they are before meeting in person.",
    color: "from-cyan-500/20 to-teal-500/20",
    iconColor: "text-cyan-400",
  },
  {
    icon: MapPin,
    title: "Meet in public first",
    description: "Always choose a public place for your first in-person date. Coffee shops and busy restaurants are great options.",
    color: "from-pink-500/20 to-rose-500/20",
    iconColor: "text-pink-400",
  },
  {
    icon: Shield,
    title: "Trust your instincts",
    description: "If something feels off, it probably is. Don't hesitate to end a date early or block someone who makes you uncomfortable.",
    color: "from-emerald-500/20 to-green-500/20",
    iconColor: "text-emerald-400",
  },
  {
    icon: Heart,
    title: "Tell a friend",
    description: "Share your date plans with someone you trust. Send them your location and check in during and after the date.",
    color: "from-orange-500/20 to-amber-500/20",
    iconColor: "text-orange-400",
  },
  {
    icon: Video,
    title: "Don't share too much",
    description: "Protect your personal info. Avoid sharing your home address, workplace, or financial details until you really know someone.",
    color: "from-blue-500/20 to-indigo-500/20",
    iconColor: "text-blue-400",
  },
];

const SafetyTipsCarousel = ({ onBack }: SafetyTipsCarouselProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const goNext = () => {
    setCurrentIndex((prev) => (prev + 1) % safetyTips.length);
  };

  const goPrev = () => {
    setCurrentIndex((prev) => (prev - 1 + safetyTips.length) % safetyTips.length);
  };

  const currentTip = safetyTips[currentIndex];

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
              Safety Tips
            </h2>
            <p className="text-sm text-muted-foreground">
              Dating best practices
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Progress dots */}
        <div className="flex justify-center gap-2">
          {safetyTips.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`w-2 h-2 rounded-full transition-all ${
                index === currentIndex
                  ? "bg-primary w-6"
                  : "bg-secondary hover:bg-muted-foreground"
              }`}
            />
          ))}
        </div>

        {/* Tip Card */}
        <div className="relative min-h-[300px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
              className={`p-6 rounded-3xl bg-gradient-to-br ${currentTip.color} border border-white/10`}
            >
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-card/50 flex items-center justify-center">
                  <currentTip.icon className={`w-8 h-8 ${currentTip.iconColor}`} />
                </div>
                <h3 className="text-xl font-display font-bold text-foreground">
                  {currentTip.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {currentTip.description}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            onClick={goPrev}
            className="w-12 h-12 rounded-full"
          >
            <ChevronLeft className="w-6 h-6" />
          </Button>

          <p className="text-sm text-muted-foreground">
            {currentIndex + 1} of {safetyTips.length}
          </p>

          <Button
            variant="ghost"
            size="icon"
            onClick={goNext}
            className="w-12 h-12 rounded-full"
          >
            <ChevronRight className="w-6 h-6" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

export default SafetyTipsCarousel;
