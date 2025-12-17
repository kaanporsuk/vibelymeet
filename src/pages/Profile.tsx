import { Settings, Edit2, LogOut, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/BottomNav";
import { useNavigate } from "react-router-dom";

const mockProfile = {
  name: "Alex",
  age: 27,
  image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
  vibes: ["Music Lover", "Gamer", "Night Owl", "Tech Nerd"],
  stats: {
    events: 8,
    matches: 12,
    vibes: 4,
  },
};

const menuItems = [
  { icon: Edit2, label: "Edit Profile", action: "edit" },
  { icon: Settings, label: "Settings", action: "settings" },
];

const Profile = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header with Photo */}
      <div className="relative">
        <div className="h-48 bg-gradient-primary" />
        <div className="absolute -bottom-16 left-1/2 -translate-x-1/2">
          <div className="relative">
            <img
              src={mockProfile.image}
              alt={mockProfile.name}
              className="w-32 h-32 rounded-3xl object-cover border-4 border-background"
            />
            <button className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <Edit2 className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 pt-20 space-y-6">
        {/* Name & Bio */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-display font-bold text-foreground">
            {mockProfile.name}, {mockProfile.age}
          </h1>
          <div className="flex flex-wrap justify-center gap-2">
            {mockProfile.vibes.map((vibe) => (
              <span
                key={vibe}
                className="px-3 py-1 text-sm rounded-full bg-primary/20 text-primary"
              >
                {vibe}
              </span>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="glass-card p-6">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-display font-bold gradient-text">
                {mockProfile.stats.events}
              </p>
              <p className="text-sm text-muted-foreground">Events</p>
            </div>
            <div className="border-x border-border">
              <p className="text-2xl font-display font-bold gradient-text">
                {mockProfile.stats.matches}
              </p>
              <p className="text-sm text-muted-foreground">Matches</p>
            </div>
            <div>
              <p className="text-2xl font-display font-bold gradient-text">
                {mockProfile.stats.vibes}
              </p>
              <p className="text-sm text-muted-foreground">Vibes</p>
            </div>
          </div>
        </div>

        {/* Menu */}
        <div className="glass-card divide-y divide-border">
          {menuItems.map((item) => (
            <button
              key={item.action}
              className="w-full flex items-center gap-4 p-4 hover:bg-secondary/50 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
                <item.icon className="w-5 h-5 text-foreground" />
              </div>
              <span className="flex-1 text-left font-medium text-foreground">
                {item.label}
              </span>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
          ))}
        </div>

        {/* Logout */}
        <Button
          variant="ghost"
          className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => navigate("/")}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Log Out
        </Button>
      </main>

      <BottomNav />
    </div>
  );
};

export default Profile;
