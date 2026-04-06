import { useEffect, useMemo, useRef, useState } from "react";
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
  const [day, setDay] = useState(() => {
    const initial = parseDateParts(value);
    return initial ? String(initial.day) : "";
  });
  const [month, setMonth] = useState(() => {
    const initial = parseDateParts(value);
    return initial ? String(initial.month) : "";
  });
  const [year, setYear] = useState(() => {
    const initial = parseDateParts(value);
    return initial ? String(initial.year) : "";
  });
  const lastEmittedRef = useRef<string>("");
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    const parsed = parseDateParts(value);
    if (parsed) {
      setDay(String(parsed.day));
      setMonth(String(parsed.month));
      setYear(String(parsed.year));
      return;
    }
    // Only clear local state when parent clears a value we emitted.
    if (!value && lastEmittedRef.current) {
      setDay("");
      setMonth("");
      setYear("");
      lastEmittedRef.current = "";
    }
  }, [value]);

  const maybeEmit = (nextDay: string, nextMonth: string, nextYear: string) => {
    const d = parseInt(nextDay, 10);
    const m = parseInt(nextMonth, 10);
    const y = parseInt(nextYear, 10);
    if (!d || !m || !y) return;

    const safeDay = Math.min(d, daysInMonth(y, m));
    if (safeDay !== d) setDay(String(safeDay));
    const iso = formatIsoDate({ year: y, month: m, day: safeDay });
    lastEmittedRef.current = iso;
    onChange(iso);
  };

  const handleDayChange = (nextDay: string) => {
    setDay(nextDay);
    maybeEmit(nextDay, month, year);
  };

  const handleMonthChange = (nextMonth: string) => {
    let nextDay = day;
    const d = parseInt(day, 10);
    const m = parseInt(nextMonth, 10);
    const y = parseInt(year, 10);
    if (d && m && y) {
      nextDay = String(Math.min(d, daysInMonth(y, m)));
    }
    setMonth(nextMonth);
    setDay(nextDay);
    maybeEmit(nextDay, nextMonth, year);
  };

  const handleYearChange = (nextYear: string) => {
    let nextDay = day;
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(nextYear, 10);
    if (d && m && y) {
      nextDay = String(Math.min(d, daysInMonth(y, m)));
    }
    setYear(nextYear);
    setDay(nextDay);
    maybeEmit(nextDay, month, nextYear);
  };

  const fullIso = useMemo(() => {
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (!d || !m || !y) return "";
    return formatIsoDate({ year: y, month: m, day: Math.min(d, daysInMonth(y, m)) });
  }, [day, month, year]);
  const age = useMemo(() => calculateAgeFromIsoDate(fullIso), [fullIso]);
  const valid = !!fullIso && age != null && age >= 18;

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
          value={day}
          onChange={(e) => handleDayChange(e.target.value)}
          className={selectClass}
        >
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={String(d)}>{d}</option>
          ))}
        </select>

        <select
          value={month}
          onChange={(e) => handleMonthChange(e.target.value)}
          className={selectClass}
        >
          <option value="">Month</option>
          {MONTHS.map((label, i) => (
            <option key={i} value={String(i + 1)}>{label}</option>
          ))}
        </select>

        <select
          value={year}
          onChange={(e) => handleYearChange(e.target.value)}
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
