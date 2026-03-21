import { Home, Calendar, Heart, User, Droplet } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

const navItems = [
  { icon: Home, label: "Now", path: "/home" },
  { icon: Calendar, label: "Events", path: "/events" },
  { icon: Heart, label: "Vibe", path: "/matches" },
  { icon: User, label: "You", path: "/profile" },
];

const DROP_HOUR = 18;

/** Floating dark-glass dock — parity with native tab bar */
export const BottomNav = () => {
  const location = useLocation();
  const [dropReady, setDropReady] = useState(false);

  useEffect(() => {
    const checkDropStatus = () => {
      const now = new Date();
      const isAfterDropTime = now.getHours() >= DROP_HOUR;
      const todayKey = now.toISOString().split("T")[0];
      try {
        const stored = localStorage.getItem("vibely_drop_history");
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
    <nav
      className={cn(
        "fixed z-50 flex max-w-lg items-center justify-around rounded-3xl border pb-safe",
        "bottom-3 left-4 right-4 mx-auto",
        "bg-black/75 backdrop-blur-[20px] supports-[backdrop-filter]:bg-black/75",
        "border-[rgba(139,92,246,0.2)]",
        "shadow-[0_0_20px_rgba(139,92,246,0.1),0_4px_12px_rgba(0,0,0,0.3)]",
        "px-3 py-2",
      )}
      style={{ WebkitBackdropFilter: "blur(20px)" }}
    >
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
        const showBadge = item.path === "/home" && dropReady;

        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 rounded-2xl px-2 py-1 transition-colors duration-150 ease-out",
              isActive ? "text-[#8B5CF6]" : "text-muted-foreground",
            )}
          >
            <div className="relative flex h-[22px] w-[22px] items-center justify-center">
              <item.icon className="h-[22px] w-[22px] shrink-0" strokeWidth={isActive ? 2.25 : 2} />
              {showBadge ? (
                <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-cyan-400 animate-pulse">
                  <Droplet className="h-2 w-2 text-black" />
                </span>
              ) : null}
            </div>
            <span className="max-w-[4.5rem] truncate text-center text-[11px] font-semibold leading-none">
              {item.label}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
};
