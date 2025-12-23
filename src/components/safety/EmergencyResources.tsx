import { motion } from "framer-motion";
import { ArrowLeft, Phone, MessageCircle, Globe, ExternalLink, Heart, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmergencyResourcesProps {
  onBack: () => void;
}

const resources = [
  {
    category: "Crisis Support",
    items: [
      {
        name: "National Suicide Prevention Lifeline",
        phone: "988",
        description: "24/7 crisis support",
        icon: Phone,
      },
      {
        name: "Crisis Text Line",
        phone: "Text HOME to 741741",
        description: "Free 24/7 text support",
        icon: MessageCircle,
      },
    ],
  },
  {
    category: "Domestic Violence",
    items: [
      {
        name: "National Domestic Violence Hotline",
        phone: "1-800-799-7233",
        description: "24/7 confidential support",
        icon: Heart,
      },
      {
        name: "RAINN (Sexual Assault)",
        phone: "1-800-656-4673",
        description: "24/7 victim support",
        icon: Shield,
      },
    ],
  },
  {
    category: "Online Resources",
    items: [
      {
        name: "Online Dating Safety Tips",
        url: "https://www.consumer.ftc.gov",
        description: "FTC guidelines for safe dating",
        icon: Globe,
      },
    ],
  },
];

const EmergencyResources = ({ onBack }: EmergencyResourcesProps) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 p-6 pb-4 bg-card border-b border-border/50">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-full bg-secondary/50 flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-display font-bold text-foreground">
              Emergency Resources
            </h2>
            <p className="text-sm text-muted-foreground">
              Help is available 24/7
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Emergency Call */}
        <motion.a
          href="tel:911"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="block p-4 rounded-2xl bg-gradient-to-r from-red-500/20 to-orange-500/20 border border-red-500/30"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-red-500/30 flex items-center justify-center">
              <Phone className="w-7 h-7 text-red-400" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-foreground text-lg">Emergency: 911</p>
              <p className="text-sm text-muted-foreground">
                If you're in immediate danger
              </p>
            </div>
            <ExternalLink className="w-5 h-5 text-red-400" />
          </div>
        </motion.a>

        {/* Resources by category */}
        {resources.map((category, categoryIndex) => (
          <div key={category.category} className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {category.category}
            </h3>
            <div className="space-y-2">
              {category.items.map((item, itemIndex) => (
                <motion.a
                  key={item.name}
                  href={item.url || `tel:${item.phone?.replace(/\D/g, "")}`}
                  target={item.url ? "_blank" : undefined}
                  rel={item.url ? "noopener noreferrer" : undefined}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: categoryIndex * 0.1 + itemIndex * 0.05 }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="flex items-center gap-3 p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                    <item.icon className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-foreground text-sm">{item.name}</p>
                    <p className="text-xs text-primary font-medium">
                      {item.phone || item.url}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </motion.a>
              ))}
            </div>
          </div>
        ))}

        {/* Reassurance message */}
        <div className="p-4 rounded-xl bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20">
          <p className="text-sm text-center text-muted-foreground">
            You're not alone. These resources are confidential and here to help.
          </p>
        </div>
      </div>
    </motion.div>
  );
};

export default EmergencyResources;
