import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

const CATEGORIES = [
  { label: "🐛 Bug Report", value: "bug" },
  { label: "💡 Feature Idea", value: "feature" },
  { label: "❓ Question", value: "question" },
  { label: "💬 Other", value: "other" },
] as const;

type CategoryValue = (typeof CATEGORIES)[number]["value"];

interface FeedbackDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const FeedbackDrawer = ({ open, onOpenChange }: FeedbackDrawerProps) => {
  const { user } = useAuth();
  const [category, setCategory] = useState<CategoryValue | null>(null);
  const [message, setMessage] = useState("");
  const [includeDeviceInfo, setIncludeDeviceInfo] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = category !== null && message.trim().length >= 10;

  const handleSubmit = async () => {
    if (!isValid || !user) return;
    if (!navigator.onLine) {
      toast.error("You're offline — we'll need a connection to send this");
      return;
    }
    setIsSubmitting(true);

    const deviceInfo = includeDeviceInfo
      ? {
          width: window.innerWidth,
          height: window.innerHeight,
          userAgent: navigator.userAgent,
          pathname: window.location.pathname,
        }
      : null;

    const { error } = await supabase.from("feedback").insert({
      user_id: user.id,
      category,
      message: message.trim(),
      device_info: deviceInfo,
      page_url: window.location.pathname,
    });

    setIsSubmitting(false);

    if (error) {
      toast.error("Failed to send feedback. Please try again.");
      return;
    }

    toast.success("Thanks for your feedback! 💜");
    setCategory(null);
    setMessage("");
    setIncludeDeviceInfo(true);
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader>
          <DrawerTitle className="font-display flex items-center gap-2">
            <MessageSquareText className="w-5 h-5 text-primary" />
            Help & Feedback
          </DrawerTitle>
          <DrawerDescription>Tell us what's on your mind</DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-2 space-y-5 overflow-y-auto">
          {/* Category Pills */}
          <div>
            <p className="text-sm font-medium text-foreground mb-3">What's this about?</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => setCategory(value)}
                  className={`px-4 py-2 rounded-full text-sm border transition-all ${
                    category === value
                      ? "bg-primary/20 border-primary text-primary"
                      : "bg-secondary/40 border-border text-muted-foreground hover:bg-secondary/60"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Message Textarea */}
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Your message</p>
            <Textarea
              placeholder="Describe what happened or what you'd like to see..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="resize-none min-h-[80px] max-h-[160px]"
            />
            <p className="text-xs text-muted-foreground mt-1 text-right">
              {message.trim().length < 10
                ? `${10 - message.trim().length} more characters needed`
                : `${message.trim().length} characters`}
            </p>
          </div>

          {/* Device Info Toggle */}
          <div className="flex items-start justify-between gap-4 p-3 rounded-xl bg-secondary/40">
            <div>
              <p className="text-sm font-medium text-foreground">Include device info</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Helps us debug issues faster (screen size, browser, OS)
              </p>
            </div>
            <Switch
              checked={includeDeviceInfo}
              onCheckedChange={setIncludeDeviceInfo}
            />
          </div>
        </div>

        <DrawerFooter>
          <Button
            variant="gradient"
            className="w-full"
            disabled={!isValid || isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? "Sending..." : "Send Feedback"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};
