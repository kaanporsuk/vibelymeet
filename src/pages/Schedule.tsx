import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VibeSchedule } from "@/components/schedule/VibeSchedule";
import { BottomNav } from "@/components/BottomNav";

const SchedulePage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Header */}
      <header className="shrink-0 flex items-center gap-4 px-4 py-3 border-b border-border/50">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="text-foreground"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-display font-semibold text-foreground">
          My Schedule
        </h1>
      </header>

      {/* Schedule Content */}
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex-1 overflow-hidden"
      >
        <VibeSchedule />
      </motion.main>

      <BottomNav />
    </div>
  );
};

export default SchedulePage;
