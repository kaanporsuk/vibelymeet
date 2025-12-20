import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Ruler, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeightSelectorProps {
  value: number; // in cm
  onChange: (cm: number) => void;
  min?: number;
  max?: number;
}

export const HeightSelector = ({ 
  value, 
  onChange, 
  min = 140, 
  max = 220 
}: HeightSelectorProps) => {
  const [localValue, setLocalValue] = useState(value || 170);

  useEffect(() => {
    setLocalValue(value || 170);
  }, [value]);

  const increment = () => {
    if (localValue < max) {
      const newValue = localValue + 1;
      setLocalValue(newValue);
      onChange(newValue);
    }
  };

  const decrement = () => {
    if (localValue > min) {
      const newValue = localValue - 1;
      setLocalValue(newValue);
      onChange(newValue);
    }
  };

  // Visual representation position (0-100%)
  const position = ((localValue - min) / (max - min)) * 100;

  return (
    <div className="space-y-4">
      {/* Main display */}
      <div className="flex items-center justify-center gap-6">
        <button
          onClick={decrement}
          disabled={localValue <= min}
          className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center disabled:opacity-30 hover:bg-secondary/80 transition-colors"
        >
          <ChevronDown className="w-6 h-6" />
        </button>
        
        <div className="text-center">
          <motion.p
            key={localValue}
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-5xl font-display font-bold gradient-text"
          >
            {localValue}
          </motion.p>
          <p className="text-sm text-muted-foreground mt-1">centimeters</p>
        </div>
        
        <button
          onClick={increment}
          disabled={localValue >= max}
          className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center disabled:opacity-30 hover:bg-secondary/80 transition-colors"
        >
          <ChevronUp className="w-6 h-6" />
        </button>
      </div>

      {/* Visual ruler */}
      <div className="relative h-16 mx-4">
        {/* Background */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 bg-secondary rounded-full overflow-hidden">
          {/* Progress fill */}
          <motion.div
            className="h-full bg-gradient-primary"
            initial={{ width: 0 }}
            animate={{ width: `${position}%` }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        </div>
        
        {/* Marker */}
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
          initial={{ left: 0 }}
          animate={{ left: `${position}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <div className="w-5 h-5 rounded-full bg-primary border-2 border-background shadow-lg neon-glow-violet" />
        </motion.div>
        
        {/* Labels */}
        <div className="absolute bottom-0 inset-x-0 flex justify-between text-xs text-muted-foreground">
          <span>{min} cm</span>
          <span>{max} cm</span>
        </div>
      </div>

      {/* Quick selects */}
      <div className="flex justify-center gap-2">
        {[160, 170, 180, 190].map((height) => (
          <button
            key={height}
            onClick={() => {
              setLocalValue(height);
              onChange(height);
            }}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm transition-all",
              localValue === height
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            {height}
          </button>
        ))}
      </div>
    </div>
  );
};

// Display component for showing height
interface HeightDisplayProps {
  cm: number;
}

export const HeightDisplay = ({ cm }: HeightDisplayProps) => {
  if (!cm) return <span className="text-muted-foreground">Not set</span>;
  
  return (
    <span className="text-sm font-medium text-foreground">
      {cm} cm
    </span>
  );
};
