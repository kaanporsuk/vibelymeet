import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  calculateAgeFromIsoDate,
  daysInMonth,
  formatIsoDate,
  parseDateParts,
} from "@/utils/onboardingDate";

interface BirthdayStepProps {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onAgeBlocked: () => void;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const BirthdayStep = ({ value, onChange, onNext, onAgeBlocked }: BirthdayStepProps) => {
  const parsed = useMemo(() => {
    const p = parseDateParts(value);
    if (!p) return { day: "", month: "", year: "" };
    return {
      day: String(p.day),
      month: String(p.month),
      year: String(p.year),
    };
  }, [value]);

  const age = useMemo(() => calculateAgeFromIsoDate(value), [value]);
  const currentYear = new Date().getFullYear();

  const setDate = (day: string, month: string, year: string) => {
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (!d || !m || !y) {
      onChange("");
      return;
    }
    const maxDay = daysInMonth(y, m);
    const safeDay = Math.min(d, maxDay);
    const date = new Date(y, m - 1, safeDay);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== safeDay) {
      onChange("");
      return;
    }
    onChange(formatIsoDate({ year: y, month: m, day: safeDay }));
  };

  const valid = !!value && age != null && age >= 18;

  const handleContinue = () => {
    if (age != null && age < 18) {
      onAgeBlocked();
      return;
    }
    onNext();
  };

  const selectClass =
    "bg-secondary/50 border border-secondary rounded-xl px-3 py-3 text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50 flex-1 min-w-0";

  return (
    <div className="flex flex-col gap-6 pt-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          When's your birthday?
        </h1>
        <p className="text-muted-foreground mt-2">
          Your age will be shown on your profile. You must be 18+.
        </p>
      </div>

      <div className="flex gap-3">
        <select
          value={parsed.day}
          onChange={(e) => setDate(e.target.value, parsed.month, parsed.year)}
          className={selectClass}
        >
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={String(d)}>{d}</option>
          ))}
        </select>

        <select
          value={parsed.month}
          onChange={(e) => setDate(parsed.day, e.target.value, parsed.year)}
          className={selectClass}
        >
          <option value="">Month</option>
          {MONTHS.map((label, i) => (
            <option key={i} value={String(i + 1)}>{label}</option>
          ))}
        </select>

        <select
          value={parsed.year}
          onChange={(e) => setDate(parsed.day, parsed.month, e.target.value)}
          className={selectClass}
        >
          <option value="">Year</option>
          {Array.from({ length: currentYear - 18 - 1940 + 1 }, (_, i) => currentYear - 18 - i).map((y) => (
            <option key={y} value={String(y)}>{y}</option>
          ))}
        </select>
      </div>

      {age != null && (
        <p className="text-muted-foreground text-sm">
          You're <span className="text-foreground font-semibold">{age}</span>
        </p>
      )}

      <Button
        onClick={handleContinue}
        disabled={!valid}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        Continue
      </Button>
    </div>
  );
};
