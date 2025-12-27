import { useState, useEffect } from "react";
import { Calendar, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useUserRegistrations, useRegisterForEvent } from "@/hooks/useRegistrations";
import { useQueryClient } from "@tanstack/react-query";

interface EventCardProps {
  id: string;
  title: string;
  image: string;
  date: string;
  time: string;
  attendees: number;
  tags: string[];
  isRegistered?: boolean;
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
}: EventCardProps) => {
  const queryClient = useQueryClient();
  const { data: userRegistrations = [] } = useUserRegistrations();
  const { registerForEvent } = useRegisterForEvent();
  
  const [isRegistered, setIsRegistered] = useState(initialRegistered);
  const [isLoading, setIsLoading] = useState(false);

  // Sync with server registration state
  useEffect(() => {
    setIsRegistered(userRegistrations.includes(id));
  }, [userRegistrations, id]);

  const handleRegister = async () => {
    setIsLoading(true);
    
    const success = await registerForEvent(id);
    
    if (success) {
      setIsRegistered(true);
      queryClient.invalidateQueries({ queryKey: ["user-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success(`You're registered for ${title}! 🎉`);
    } else {
      toast.error("Failed to register. Please try again.");
    }
    
    setIsLoading(false);
  };

  return (
    <div className="glass-card overflow-hidden group">
      <div className="relative h-40 overflow-hidden">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        />
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
            <span>{attendees}</span>
          </div>
        </div>

        <Button
          variant={isRegistered ? "outline" : "gradient"}
          size="sm"
          className={cn("w-full", isRegistered && "border-neon-cyan text-neon-cyan")}
          onClick={handleRegister}
          disabled={isRegistered || isLoading}
        >
          {isLoading ? (
            <span className="animate-pulse">Registering...</span>
          ) : isRegistered ? (
            "✓ Registered"
          ) : (
            "Register"
          )}
        </Button>
      </div>
    </div>
  );
};
