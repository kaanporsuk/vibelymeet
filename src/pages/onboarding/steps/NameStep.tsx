import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface NameStepProps {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}

export const NameStep = ({ value, onChange, onNext }: NameStepProps) => {
  const valid = value.trim().length > 0;

  return (
    <div className="flex flex-col gap-6 pt-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          What's your first name?
        </h1>
        <p className="text-muted-foreground mt-2">
          This is how you'll appear on Vibely.
        </p>
      </div>

      <Input
        autoFocus
        maxLength={20}
        placeholder="Your first name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid) onNext();
        }}
        className="text-lg py-6 bg-secondary/50 border-secondary"
      />

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
