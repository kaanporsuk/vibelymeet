import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeightSelector } from "@/components/HeightSelector";

interface BasicsStepProps {
  heightCm: number | null;
  job: string;
  onHeightChange: (v: number | null) => void;
  onJobChange: (v: string) => void;
  onNext: () => void;
}

export const BasicsStep = ({
  heightCm,
  job,
  onHeightChange,
  onJobChange,
  onNext,
}: BasicsStepProps) => {
  return (
    <div className="flex flex-col gap-6 pt-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          A couple more details
        </h1>
        <p className="text-muted-foreground mt-2">
          These help with matching, but they're optional.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <label className="text-sm font-medium text-foreground mb-3 block">Height</label>
          <HeightSelector
            value={heightCm ?? 170}
            onChange={(v) => onHeightChange(v)}
          />
          {heightCm && (
            <button
              onClick={() => onHeightChange(null)}
              className="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
            >
              Clear height
            </button>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-foreground mb-2 block">
            What do you do?
          </label>
          <Input
            placeholder="Designer, student, chef, dreamer..."
            value={job}
            onChange={(e) => onJobChange(e.target.value)}
            maxLength={50}
            className="bg-secondary/50 border-secondary"
          />
        </div>
      </div>

      <Button
        onClick={onNext}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        Continue
      </Button>
    </div>
  );
};
