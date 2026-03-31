import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface OtpInputProps {
  onComplete: (code: string) => void;
  error?: string;
  disabled?: boolean;
}

export const OtpInput = ({ onComplete, error, disabled }: OtpInputProps) => {
  const [values, setValues] = useState<string[]>(["", "", "", "", "", ""]);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  useEffect(() => {
    const code = values.join("");
    if (code.length === 6 && !values.includes("")) {
      onComplete(code);
    }
  }, [values, onComplete]);

  const handleChange = (index: number, v: string) => {
    if (disabled) return;
    const numeric = v.replace(/\D/g, "");
    if (!numeric) {
      setValues((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      return;
    }

    // Paste / autofill of full code
    if (numeric.length === 6) {
      setValues(numeric.split("").slice(0, 6));
      return;
    }

    setValues((prev) => {
      const next = [...prev];
      next[index] = numeric[0] ?? "";
      return next;
    });

    if (index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === "Backspace" && !values[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const text = e.clipboardData.getData("text").replace(/\D/g, "");
    if (text.length === 6) {
      e.preventDefault();
      setValues(text.split("").slice(0, 6));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-center gap-2">
        {values.map((val, idx) => (
          <input
            key={idx}
            ref={(el) => {
              inputsRef.current[idx] = el;
            }}
            type="tel"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={val}
            disabled={disabled}
            onChange={(e) => handleChange(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            onPaste={idx === 0 ? handlePaste : undefined}
            className={cn(
              "w-12 h-14 rounded-lg border text-center text-xl font-mono bg-secondary/60",
              "border-border text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-0",
              error && "border-destructive/80 text-destructive"
            )}
          />
        ))}
      </div>
      {error && <p className="text-xs text-center text-destructive">{error}</p>}
    </div>
  );
};

