import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Shield, 
  AlertTriangle, 
  Book, 
  Phone, 
  X,
  ChevronRight,
  Moon,
  UserX,
  Flag,
  MessageCircleWarning,
  Eye,
  CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ReportWizard from "./ReportWizard";
import PauseAccountFlow from "./PauseAccountFlow";
import SafetyTipsCarousel from "./SafetyTipsCarousel";
import EmergencyResources from "./EmergencyResources";

interface SafetyHubProps {
  isOpen: boolean;
  onClose: () => void;
}

type SafetyView = "main" | "report" | "tips" | "emergency" | "pause";

const SafetyHub = ({ isOpen, onClose }: SafetyHubProps) => {
  const [view, setView] = useState<SafetyView>("main");

  const handleClose = () => {
    setView("main");
    onClose();
  };

  const quickActions = [
    {
      id: "report",
      icon: Flag,
      label: "Report a User",
      description: "Report harassment, fake profiles, or abuse",
      color: "from-red-500/20 to-orange-500/20",
      iconColor: "text-red-400",
      onClick: () => setView("report"),
    },
    {
      id: "tips",
      icon: Book,
      label: "Safety Tips",
      description: "Dating safety best practices",
      color: "from-cyan-500/20 to-teal-500/20",
      iconColor: "text-cyan-400",
      onClick: () => setView("tips"),
    },
    {
      id: "emergency",
      icon: Phone,
      label: "Emergency Resources",
      description: "Helplines & support services",
      color: "from-violet-500/20 to-purple-500/20",
      iconColor: "text-violet-400",
      onClick: () => setView("emergency"),
    },
    {
      id: "pause",
      icon: Moon,
      label: "Take a Vibe Break",
      description: "Pause your profile temporarily",
      color: "from-blue-500/20 to-indigo-500/20",
      iconColor: "text-blue-400",
      onClick: () => setView("pause"),
    },
  ];

  const recentActions = [
    { icon: UserX, label: "Blocked user: Jamie K.", time: "2 days ago" },
    { icon: Eye, label: "Profile view settings updated", time: "5 days ago" },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-md flex items-end sm:items-center justify-center"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-card rounded-t-3xl sm:rounded-3xl border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <AnimatePresence mode="wait">
              {view === "main" && (
                <motion.div
                  key="main"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {/* Header */}
                  <div className="sticky top-0 z-10 p-6 pb-4 bg-gradient-to-b from-teal-950/50 to-transparent border-b border-border/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500/20 to-cyan-500/20 flex items-center justify-center">
                          <Shield className="w-6 h-6 text-cyan-400" />
                        </div>
                        <div>
                          <h2 className="text-xl font-display font-bold text-foreground">
                            Safety Center
                          </h2>
                          <p className="text-sm text-muted-foreground">
                            Your wellbeing comes first
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={handleClose}
                        className="w-10 h-10 rounded-full bg-secondary/50 flex items-center justify-center hover:bg-secondary transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* Quick Actions Grid */}
                  <div className="p-6 space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Quick Actions
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {quickActions.map((action) => (
                        <motion.button
                          key={action.id}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={action.onClick}
                          className={`p-4 rounded-2xl bg-gradient-to-br ${action.color} border border-white/5 text-left transition-all hover:border-white/10`}
                        >
                          <action.icon className={`w-6 h-6 ${action.iconColor} mb-3`} />
                          <h4 className="font-semibold text-foreground text-sm mb-1">
                            {action.label}
                          </h4>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {action.description}
                          </p>
                        </motion.button>
                      ))}
                    </div>
                  </div>

                  {/* Safety Status */}
                  <div className="px-6 pb-4">
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        <div>
                          <p className="font-medium text-foreground text-sm">
                            Your account is protected
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Photo verification active • 2FA enabled
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Recent Activity */}
                  <div className="px-6 pb-8 space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Recent Activity
                    </h3>
                    <div className="space-y-2">
                      {recentActions.map((action, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30"
                        >
                          <action.icon className="w-4 h-4 text-muted-foreground" />
                          <div className="flex-1">
                            <p className="text-sm text-foreground">{action.label}</p>
                            <p className="text-xs text-muted-foreground">{action.time}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {view === "report" && (
                <ReportWizard onBack={() => setView("main")} onComplete={handleClose} />
              )}

              {view === "tips" && (
                <SafetyTipsCarousel onBack={() => setView("main")} />
              )}

              {view === "emergency" && (
                <EmergencyResources onBack={() => setView("main")} />
              )}

              {view === "pause" && (
                <PauseAccountFlow onBack={() => setView("main")} onComplete={handleClose} />
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SafetyHub;
