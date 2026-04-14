import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ChevronRight, SkipForward, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface SafetyData {
  photoAccurate: string | null;
  honestRepresentation: string | null;
}

interface SafetyScreenProps {
  onComplete: (data: SafetyData) => void;
  onSkip: () => void;
  /** Server-owned report path; `alsoBlock` is applied atomically when supported. */
  onReport: (reason: string, details: string, alsoBlock: boolean) => void | Promise<void>;
}

const ACCURACY_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "not_sure", label: "Not sure" },
  { value: "no", label: "No" },
];

const REPORT_CATEGORIES = [
  "Inappropriate behavior",
  "Fake photos",
  "Harassment",
  "Spam",
  "Other",
];

export const SafetyScreen = ({
  onComplete,
  onSkip,
  onReport,
}: SafetyScreenProps) => {
  const [photoAccurate, setPhotoAccurate] = useState<string | null>(null);
  const [honest, setHonest] = useState<string | null>(null);
  const [comfortable, setComfortable] = useState<string | null>(null);
  const [showReportFlow, setShowReportFlow] = useState(false);
  const [reportCategory, setReportCategory] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState("");
  const [wantsBlock, setWantsBlock] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const needsExpanded =
    photoAccurate === "no" || honest === "no" || comfortable === "off";

  const handleSubmit = () => {
    onComplete({
      photoAccurate,
      honestRepresentation: honest,
    });
  };

  const handleReport = async () => {
    if (reportCategory) {
      await onReport(reportCategory, reportDetails, wantsBlock);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center py-8 space-y-4"
      >
        <Shield className="w-12 h-12 text-primary mx-auto" />
        <h3 className="text-lg font-display font-bold text-foreground">
          Thanks for keeping Vibely safe
        </h3>
        <p className="text-sm text-muted-foreground">We'll review this promptly.</p>
        <Button
          onClick={() => onComplete({ photoAccurate, honestRepresentation: honest })}
          className="mt-4"
        >
          Back to the event 💚
        </Button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-5 py-2"
    >
      <div className="text-center">
        <h2 className="text-lg font-display font-bold text-foreground mb-1">
          Quick safety check
        </h2>
        <p className="text-sm text-muted-foreground">Optional but helps the community</p>
      </div>

      {/* Photo accuracy */}
      <QuestionRow
        label="Did they look like their photos?"
        value={photoAccurate}
        onChange={setPhotoAccurate}
        options={ACCURACY_OPTIONS}
      />

      {/* Honesty */}
      <QuestionRow
        label="Did they represent themselves honestly?"
        value={honest}
        onChange={setHonest}
        options={ACCURACY_OPTIONS}
      />

      {/* Comfort */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          Did anything make you uncomfortable?
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setComfortable("good")}
            className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-all ${
              comfortable === "good"
                ? "bg-primary/20 text-primary border border-primary/40"
                : "bg-secondary/30 text-muted-foreground border border-border/30"
            }`}
          >
            No, all good
          </button>
          <button
            onClick={() => {
              setComfortable("off");
              setShowReportFlow(true);
            }}
            className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-all ${
              comfortable === "off"
                ? "bg-destructive/20 text-destructive border border-destructive/40"
                : "bg-secondary/30 text-muted-foreground border border-border/30"
            }`}
          >
            Something felt off
          </button>
        </div>
      </div>

      {/* Expanded report flow */}
      <AnimatePresence>
        {(needsExpanded || showReportFlow) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-4 overflow-hidden"
          >
            <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20">
              <p className="text-sm text-foreground mb-3">
                Would you like to report this user?
              </p>

              {/* Categories */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {REPORT_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setReportCategory(cat === reportCategory ? null : cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      reportCategory === cat
                        ? "bg-destructive/20 text-destructive border border-destructive/40"
                        : "bg-secondary/30 text-muted-foreground border border-border/30"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {reportCategory && (
                <Textarea
                  placeholder="Tell us more (optional)..."
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  className="min-h-[60px] bg-secondary/30 border-border/50 resize-none text-sm"
                  maxLength={500}
                />
              )}

              {/* Block option */}
              <label className="flex items-center gap-2 mt-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wantsBlock}
                  onChange={(e) => setWantsBlock(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-xs text-muted-foreground">
                  Block them from future events
                </span>
              </label>

              {reportCategory && (
                <Button
                  onClick={handleReport}
                  variant="destructive"
                  size="sm"
                  className="w-full mt-3"
                >
                  <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
                  Submit Report
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="space-y-2">
        <Button
          onClick={handleSubmit}
          className="w-full h-11 bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground font-semibold"
        >
          <span>Done — back to the event 💚</span>
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
        <button
          onClick={onSkip}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
        >
          <SkipForward className="w-3.5 h-3.5" />
          <span>Skip</span>
        </button>
      </div>
    </motion.div>
  );
};

function QuestionRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-all ${
              value === opt.value
                ? "bg-primary/20 text-primary border border-primary/40"
                : "bg-secondary/30 text-muted-foreground border border-border/30"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
