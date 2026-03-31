import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";

const RULES = [
  {
    emoji: "🤝",
    title: "Be genuine",
    detail: "Real photos, real intentions. No catfishing.",
  },
  {
    emoji: "💬",
    title: "Be respectful",
    detail: "Consent matters, always.",
  },
  {
    emoji: "🚫",
    title: "Zero tolerance",
    detail: "Harassment, hate speech, fraud = ban.",
  },
];

interface CommunityStepProps {
  onAgree: () => void;
}

export const CommunityStep = ({ onAgree }: CommunityStepProps) => {
  return (
    <div className="flex flex-col gap-6 pt-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          Our community rules
        </h1>
        <p className="text-muted-foreground mt-2">
          Vibely is built on respect.
        </p>
      </div>

      <div className="space-y-4">
        {RULES.map((rule, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="flex items-start gap-3 p-4 rounded-xl glass-card"
          >
            <span className="text-2xl">{rule.emoji}</span>
            <div>
              <p className="font-medium text-foreground">{rule.title}</p>
              <p className="text-sm text-muted-foreground">{rule.detail}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <Button
        onClick={onAgree}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        I agree, let's go
      </Button>

      <a
        href="/community-guidelines"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
      >
        Read full guidelines
      </a>
    </div>
  );
};
