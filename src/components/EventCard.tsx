import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EventCover } from "@/components/ui/ProfilePhoto";
import { useUserRegistrations } from "@/hooks/useRegistrations";
import { getLanguageLabel } from "@/lib/eventLanguages";

interface EventCardProps {
  id: string;
  title: string;
  image: string;
  date: string;
  time: string;
  attendees: number;
  tags: string[];
  isRegistered?: boolean;
  language?: string | null;
}

export const EventCard = ({
  id,
  title,
  image,
  date,
  time,
  attendees,
  tags,
  isRegistered: initialRegistered = false,
  language,
}: EventCardProps) => {
  const navigate = useNavigate();
  const { data: admission = { confirmedEventIds: [], waitlistedEventIds: [] } } = useUserRegistrations();

  const [isConfirmed, setIsConfirmed] = useState(initialRegistered);
  const [isWaitlisted, setIsWaitlisted] = useState(false);

  useEffect(() => {
    setIsConfirmed(admission.confirmedEventIds.includes(id));
    setIsWaitlisted(admission.waitlistedEventIds.includes(id));
  }, [admission.confirmedEventIds, admission.waitlistedEventIds, id]);

  const handleCardClick = () => {
    navigate(`/events/${id}`);
  };

  const handleOpenDetails = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/events/${id}`);
  };

  return (
    <div 
      className="glass-card overflow-hidden group cursor-pointer"
      onClick={handleCardClick}
    >
      <div className="relative h-40 overflow-hidden">
        <EventCover src={image} title={title} className="!aspect-auto h-full w-full group-hover:scale-110 transition-transform duration-500" />
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
          {tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-2 py-1 text-xs font-medium rounded-full bg-primary/30 text-primary backdrop-blur-sm"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-3">
        <h3 className="font-display font-semibold text-lg text-foreground line-clamp-1">
          {title}
        </h3>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            <span>{date} • {time}</span>
          </div>
	          <div className="flex items-center gap-1.5">
	            <Users className="w-4 h-4" />
	            <span>{attendees} registered</span>
	          </div>
          {(() => {
            const lang = getLanguageLabel(language);
            return lang ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-xs text-muted-foreground">
                {lang.flag} {lang.label}
              </span>
            ) : null;
          })()}
        </div>

        <Button
          variant={isConfirmed || isWaitlisted ? "outline" : "gradient"}
          size="sm"
          className={cn("w-full", (isConfirmed || isWaitlisted) && "border-neon-cyan text-neon-cyan")}
          onClick={handleOpenDetails}
        >
          {isConfirmed ? "View Ticket" : isWaitlisted ? "On waitlist" : "Get Tickets"}
        </Button>
      </div>
    </div>
  );
};
