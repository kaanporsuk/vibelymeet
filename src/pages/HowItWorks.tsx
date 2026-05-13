import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BadgeCheck,
  Calendar,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  Gauge,
  Gift,
  HeartHandshake,
  MessageCircleHeart,
  PhoneOff,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UserRound,
  UsersRound,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/BottomNav";

type CardTone = "violet" | "pink" | "cyan";

type JourneyCard = {
  icon: LucideIcon;
  title: string;
  description: string;
  tone: CardTone;
};

type FeatureSection = {
  title: string;
  intro?: string;
  cards: JourneyCard[];
};

const toneClasses: Record<CardTone, { icon: string; accent: string }> = {
  violet: {
    icon: "border-neon-violet/30 bg-neon-violet/10 text-neon-violet",
    accent: "bg-neon-violet/60",
  },
  pink: {
    icon: "border-neon-pink/30 bg-neon-pink/10 text-neon-pink",
    accent: "bg-neon-pink/60",
  },
  cyan: {
    icon: "border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan",
    accent: "bg-neon-cyan/60",
  },
};

const vibelyLoop: JourneyCard[] = [
  {
    icon: UserRound,
    title: "Build your vibe",
    description:
      "Create a profile that shows your energy with photos, prompts, Vibe Video, Vibe Score, and verification.",
    tone: "violet",
  },
  {
    icon: Calendar,
    title: "Choose an event",
    description:
      "Join curated social and dating events. Start nearby, or use premium city discovery to explore more places.",
    tone: "pink",
  },
  {
    icon: UsersRound,
    title: "Vibe in the live lobby",
    description:
      "When an event goes live, browse guests in the event lobby and send a Vibe when someone feels right.",
    tone: "cyan",
  },
  {
    icon: CheckCircle2,
    title: "Both get ready",
    description:
      "When the interest is mutual, the Ready Gate opens. You both opt in before the live video date begins.",
    tone: "violet",
  },
  {
    icon: Video,
    title: "Meet face-to-face",
    description:
      "Start with a progressive-blur video moment, feel the chemistry, then decide if you both want to keep going.",
    tone: "pink",
  },
];

const featureSections: FeatureSection[] = [
  {
    title: "Your Vibe, Not Just Your Photos",
    intro: "Profiles are built to help people feel who you are before the first live moment.",
    cards: [
      {
        icon: Video,
        title: "Vibe Video",
        description: "A short intro that helps people feel your energy before you meet.",
        tone: "pink",
      },
      {
        icon: Gauge,
        title: "Vibe Score",
        description: "A profile-quality signal that rewards a more complete, more trustworthy profile.",
        tone: "violet",
      },
      {
        icon: Sparkles,
        title: "Profile Studio",
        description:
          "Your space to shape how you show up: photos, prompts, about me, looking for, vibes, schedule, verification, and invites.",
        tone: "cyan",
      },
    ],
  },
  {
    title: "More Ways to Connect",
    cards: [
      {
        icon: Gift,
        title: "Daily Drops",
        description: "Curated introductions for when you are not in a live event.",
        tone: "cyan",
      },
      {
        icon: MessageCircleHeart,
        title: "Chat That Keeps the Vibe Going",
        description: "Keep the vibe going with messages and richer conversation tools after a mutual connection.",
        tone: "pink",
      },
      {
        icon: Clock3,
        title: "Vibe Schedule",
        description: "Make planning easier when the connection feels right.",
        tone: "violet",
      },
      {
        icon: UserPlus,
        title: "Invite Friends",
        description: "Bring people into Vibely or invite them to a specific event.",
        tone: "cyan",
      },
    ],
  },
  {
    title: "Trust Built In",
    cards: [
      {
        icon: CheckCircle2,
        title: "Readiness before video",
        description: "Both people confirm before entering a live date.",
        tone: "violet",
      },
      {
        icon: Eye,
        title: "Progressive-blur start",
        description: "Ease into the moment before full face-to-face video.",
        tone: "pink",
      },
      {
        icon: BadgeCheck,
        title: "Verification and age checks",
        description: "Verification, age checks, reporting, blocking, and end-call controls help protect the experience.",
        tone: "cyan",
      },
      {
        icon: PhoneOff,
        title: "Report, block, or end anytime",
        description: "You stay in control before, during, and after the date.",
        tone: "violet",
      },
    ],
  },
];

const badges = ["Event-based", "Video-first", "Consent-led"];

function InfoCard({
  card,
  index,
  compact = false,
  className = "",
}: {
  card: JourneyCard;
  index: number;
  compact?: boolean;
  className?: string;
}) {
  const tone = toneClasses[card.tone];

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index }}
      className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-card/55 p-4 backdrop-blur-xl transition-colors hover:border-white/20 sm:p-5 ${className}`}
    >
      <div className={`absolute inset-x-0 top-0 h-px ${tone.accent} opacity-60`} />
      <div className={compact ? "flex gap-3" : "space-y-4"}>
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${tone.icon}`}
        >
          <card.icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h4 className="font-display text-base font-semibold leading-snug text-foreground">
            {card.title}
          </h4>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {card.description}
          </p>
        </div>
      </div>
    </motion.article>
  );
}

const HowItWorks = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background pb-[calc(9rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-40 glass-card border-b border-border/50 px-4 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="-ml-2 rounded-xl p-2 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-xl font-display font-bold text-foreground">How Vibely Works</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-12 pt-8 sm:px-6 sm:pt-12">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-card/50 px-5 py-8 text-center backdrop-blur-xl sm:px-10 sm:py-12"
        >
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-neon-violet/70 to-transparent" />
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-gradient-primary shadow-lg shadow-primary/20">
            <HeartHandshake className="h-8 w-8 text-white" />
          </div>
          <h2 className="font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl">
            Meet through real moments.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Vibely is video-first social dating built around curated events, readiness-gated live dates,
            and profiles that show more than photos.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {badges.map((badge) => (
              <span
                key={badge}
                className="rounded-full border border-white/10 bg-secondary/45 px-3 py-1 text-xs font-semibold text-foreground/85"
              >
                {badge}
              </span>
            ))}
          </div>
          <Button
            variant="gradient"
            size="lg"
            onClick={() => navigate("/events")}
            className="mt-8 w-full sm:w-auto"
          >
            <Calendar className="h-5 w-5" />
            Find Your First Event
          </Button>
        </motion.section>

        <section className="mt-12 space-y-5">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase text-primary">The Vibely Loop</p>
            <h3 className="mt-2 font-display text-2xl font-bold text-foreground">
              From profile to real chemistry.
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {vibelyLoop.map((step, index) => (
              <InfoCard
                key={step.title}
                card={step}
                index={index}
                compact
                className={index === vibelyLoop.length - 1 ? "sm:col-span-2" : ""}
              />
            ))}
          </div>
        </section>

        {featureSections.map((section, sectionIndex) => (
          <section key={section.title} className="mt-12 space-y-5">
            <div className="text-center">
              <h3 className="font-display text-2xl font-bold text-foreground">{section.title}</h3>
              {section.intro ? (
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  {section.intro}
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {section.cards.map((card, index) => (
                <InfoCard
                  key={card.title}
                  card={card}
                  index={sectionIndex * 4 + index}
                  compact={section.cards.length > 3}
                  className={
                    section.title === "Your Vibe, Not Just Your Photos" && index === section.cards.length - 1
                      ? "sm:col-span-2"
                      : ""
                  }
                />
              ))}
            </div>
          </section>
        ))}

        <section className="mt-12 rounded-[2rem] border border-primary/25 bg-gradient-to-br from-primary/10 via-card/60 to-accent/10 p-5 text-center backdrop-blur-xl sm:p-8">
          <ShieldCheck className="mx-auto h-8 w-8 text-primary" />
          <h3 className="mt-4 font-display text-2xl font-bold text-foreground">
            Ready to meet your first real vibe?
          </h3>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Join an event, build your profile, and start meeting people through moments that actually feel human.
          </p>
          <Button
            variant="gradient"
            size="lg"
            onClick={() => navigate("/events")}
            className="mt-6 w-full sm:w-auto"
          >
            <Calendar className="h-5 w-5" />
            Find Your First Event
          </Button>
        </section>

        <div className="mt-8 grid grid-cols-2 gap-3">
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-secondary/40 py-3 text-sm font-medium text-muted-foreground transition-all hover:border-border hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileText className="h-4 w-4" />
            Privacy Policy
          </a>
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-secondary/40 py-3 text-sm font-medium text-muted-foreground transition-all hover:border-border hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileText className="h-4 w-4" />
            Terms of Service
          </a>
        </div>
      </main>

      <BottomNav />
    </div>
  );
};

export default HowItWorks;
