import { Home, Calendar, Heart, User, Droplet } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

const navItems = [
  { icon: Home, label: "Home", path: "/home" },
  { icon: Calendar, label: "Events", path: "/events" },
  { icon: Heart, label: "Matches", path: "/matches" },
  { icon: User, label: "Profile", path: "/profile" },
];

const DROP_HOUR = 18;

export const BottomNav = () => {
  const location = useLocation();
  const [dropReady, setDropReady] = useState(false);

  // Check if daily drop is ready (after 6 PM and not viewed today)
  useEffect(() => {
    const checkDropStatus = () => {
      const now = new Date();
      const isAfterDropTime = now.getHours() >= DROP_HOUR;
      const todayKey = now.toISOString().split('T')[0];
      
      try {
        const stored = localStorage.getItem('vibely_drop_history');
        if (stored) {
          const history = JSON.parse(stored);
          const alreadyViewed = history.lastDropDate === todayKey;
          setDropReady(isAfterDropTime && !alreadyViewed);
        } else {
          setDropReady(isAfterDropTime);
        }
      } catch {
        setDropReady(isAfterDropTime);
      }
    };

    checkDropStatus();
    const interval = setInterval(checkDropStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass-card border-t border-white/10 pb-safe">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const showBadge = item.path === '/dashboard' && dropReady;
          
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all duration-300 relative",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div
                className={cn(
                  "p-2 rounded-xl transition-all duration-300 relative",
                  isActive && "bg-primary/20 neon-glow-violet"
                )}
              >
                <item.icon className="w-5 h-5" />
                {showBadge && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-neon-cyan flex items-center justify-center animate-pulse">
                    <Droplet className="w-2.5 h-2.5 text-background" />
                  </span>
                )}
              </div>
              <span className="text-xs font-medium">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};
