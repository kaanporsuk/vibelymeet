import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Video, Heart, Sparkles, Calendar, MessageCircle, Shield, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/BottomNav";

const steps = [
  {
    icon: Calendar,
    title: "Join an Event",
    description: "Browse curated speed dating events and pick one that matches your vibe. Each event has a unique theme and audience.",
    color: "from-neon-violet to-neon-pink",
  },
  {
    icon: Video,
    title: "5-Minute Video Dates",
    description: "Connect with matches through quick video calls. No endless swiping - just real conversations with real people.",
    color: "from-neon-cyan to-neon-violet",
  },
  {
    icon: Heart,
    title: "Match by Vibes",
    description: "After each date, decide if you felt a connection. When both of you say yes, it's a match! Start chatting instantly.",
    color: "from-neon-pink to-accent",
  },
  {
    icon: MessageCircle,
    title: "Continue the Conversation",
    description: "Keep the spark alive through our chat. Send messages, voice notes, and play fun games to get to know each other better.",
    color: "from-accent to-neon-cyan",
  },
];

const features = [
  { icon: "💧", title: "Daily Drops", description: "Get one curated match delivered to you every day at 6 PM" },
  { icon: "🎮", title: "Vibe Arcade", description: "Play fun games in chat to break the ice" },
  { icon: "📅", title: "Vibe Sync", description: "Schedule dates that work for both of you" },
  { icon: "🎬", title: "Vibe Videos", description: "Create short intro videos to show your personality" },
];

const HowItWorks = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background pb-[100px]">
      {/* Header */}
      <header className="sticky top-0 z-40 glass-card border-b border-border/50 px-4 py-4">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-xl hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-xl font-display font-bold text-foreground">How Vibely Works</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8 space-y-12">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-primary flex items-center justify-center">
            <Sparkles className="w-10 h-10 text-primary-foreground" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-3">
            Find Your Vibe
          </h2>
          <p className="text-muted-foreground">
            Vibely is video speed dating reimagined. No endless swiping, no ghosting - just real connections through face-to-face conversations.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="space-y-6">
          <h3 className="text-lg font-display font-semibold text-foreground text-center">
            How It Works
          </h3>
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="glass-card p-5 rounded-2xl"
            >
              <div className="flex gap-4">
                <div className={`w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center`}>
                  <step.icon className="w-6 h-6 text-primary-foreground" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground">Step {index + 1}</span>
                  </div>
                  <h4 className="font-display font-semibold text-foreground mb-1">
                    {step.title}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Features */}
        <div className="space-y-4">
          <h3 className="text-lg font-display font-semibold text-foreground text-center">
            Special Features
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4 + index * 0.1 }}
                className="glass-card p-4 rounded-xl text-center"
              >
                <div className="text-3xl mb-2">{feature.icon}</div>
                <h4 className="font-semibold text-foreground text-sm mb-1">{feature.title}</h4>
                <p className="text-xs text-muted-foreground">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Safety */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="glass-card p-5 rounded-2xl border border-primary/30"
        >
          <div className="flex items-center gap-3 mb-3">
            <Shield className="w-6 h-6 text-primary" />
            <h3 className="font-display font-semibold text-foreground">Your Safety Matters</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            All users are verified. Report any concerns and our team will take action. Video dates are monitored for safety, and you can end any call at any time.
          </p>
        </motion.div>

        {/* Legal Links */}
        <div className="grid grid-cols-2 gap-3">
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium bg-secondary/40 border border-border/50 text-muted-foreground hover:bg-secondary/60 hover:text-foreground hover:border-border transition-all"
          >
            <FileText className="w-4 h-4" />
            Privacy Policy
          </a>
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium bg-secondary/40 border border-border/50 text-muted-foreground hover:bg-secondary/60 hover:text-foreground hover:border-border transition-all"
          >
            <FileText className="w-4 h-4" />
            Terms of Service
          </a>
        </div>

        {/* CTA */}
        <div className="text-center space-y-4">
          <Button
            variant="gradient"
            size="lg"
            onClick={() => navigate("/events")}
            className="w-full"
          >
            <Calendar className="w-5 h-5 mr-2" />
            Find Your First Event
          </Button>
          <p className="text-sm text-muted-foreground">
            Ready to find your vibe? Join an event and start connecting!
          </p>
        </div>
      </main>

      <BottomNav />
    </div>
  );
};

export default HowItWorks;
