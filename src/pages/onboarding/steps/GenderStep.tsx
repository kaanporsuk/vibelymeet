import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { label: "Man", value: "man" },
  { label: "Woman", value: "woman" },
  { label: "Non-binary", value: "non-binary" },
  { label: "Other", value: "other" },
];

interface GenderStepProps {
  value: string;
  customValue: string;
  onChange: (v: string) => void;
  onChangeCustom: (v: string) => void;
  onNext: () => void;
}

export const GenderStep = ({
  value,
  customValue,
  onChange,
  onChangeCustom,
  onNext,
}: GenderStepProps) => {
  const valid = !!value;

  return (
    <div className="flex flex-col gap-6 pt-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          How do you identify?
        </h1>
      </div>

      <div className="space-y-3">
        {OPTIONS.map((opt, i) => (
          <motion.button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "w-full flex items-center gap-3 p-4 rounded-xl transition-all text-left",
              value === opt.value
                ? "bg-primary/20 border-2 border-primary"
                : "glass-card hover:border-primary/30"
            )}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{opt.label}</p>
            </div>
            {value === opt.value && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-5 h-5 rounded-full bg-primary flex items-center justify-center"
              >
                <span className="text-[10px] text-white">✓</span>
              </motion.div>
            )}
          </motion.button>
        ))}
      </div>

      {value === "other" && (
        <Input
          autoFocus
          placeholder="Tell us"
          maxLength={30}
          value={customValue}
          onChange={(e) => onChangeCustom(e.target.value)}
          className="bg-secondary/50 border-secondary"
        />
      )}

      <Button
        onClick={onNext}
        disabled={!valid}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        Continue
      </Button>
    </div>
  );
};
