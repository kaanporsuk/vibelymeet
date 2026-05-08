import {
  Bell,
  Calendar,
  CheckCircle2,
  CreditCard,
  Droplet,
  Heart,
  MessageCircle,
  Radio,
  ShieldAlert,
  Sparkles,
  UserCheck,
  Video,
  Zap,
} from "lucide-react";

export function iconForNotificationCategory(category: string) {
  switch (category) {
    case "message":
      return MessageCircle;
    case "new_match":
      return Heart;
    case "ready_gate":
      return Zap;
    case "video_date":
      return Video;
    case "event_live":
      return Radio;
    case "event_reminder":
      return Calendar;
    case "daily_drop":
      return Droplet;
    case "someone_vibed_you":
    case "super_vibe":
      return Sparkles;
    case "verification":
      return UserCheck;
    case "credits_subscription":
      return CreditCard;
    case "safety":
      return ShieldAlert;
    case "system":
      return CheckCircle2;
    default:
      return Bell;
  }
}
