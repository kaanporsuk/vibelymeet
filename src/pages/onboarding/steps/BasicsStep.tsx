import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeightSelector } from "@/components/HeightSelector";

const COMMON_HEIGHTS_CM = [160, 170, 180, 190] as const;

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
  const hasHeight = heightCm != null;

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
          {!hasHeight ? (
            <div className="space-y-4 rounded-xl border border-border bg-secondary/30 px-4 py-5">
              <p className="text-center text-sm text-muted-foreground">
                No height on your profile yet. Pick a common height, or continue without one.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {COMMON_HEIGHTS_CM.map((height) => (
                  <button
                    key={height}
                    type="button"
                    onClick={() => onHeightChange(height)}
                    className="rounded-lg bg-secondary px-3 py-1.5 text-sm text-muted-foreground transition-all hover:text-foreground"
                  >
                    {height} cm
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <HeightSelector
                value={heightCm}
                onChange={(v) => onHeightChange(v)}
              />
              <button
                type="button"
                onClick={() => onHeightChange(null)}
                className="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
              >
                Clear height
              </button>
            </>
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
