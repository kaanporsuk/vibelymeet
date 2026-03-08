import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Users,
  DollarSign,
  Sparkles,
  Video,
  MapPin,
  Image,
  Save,
  Eye,
  Zap,
  Upload,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uploadEventCoverToBunny } from "@/services/eventCoverUploadService";

const eventThemes = [
  { id: "tech", label: "Tech Founders", emoji: "💻", color: "from-cyan-500 to-blue-600" },
  { id: "travel", label: "Travel Lovers", emoji: "✈️", color: "from-emerald-500 to-teal-600" },
  { id: "foodies", label: "Foodies", emoji: "🍷", color: "from-orange-500 to-red-600" },
  { id: "creatives", label: "Creatives", emoji: "🎨", color: "from-pink-500 to-purple-600" },
  { id: "fitness", label: "Fitness & Wellness", emoji: "💪", color: "from-green-500 to-emerald-600" },
  { id: "music", label: "Music & Nightlife", emoji: "🎵", color: "from-violet-500 to-purple-600" },
];

const AdminCreateEvent = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Form state
  const [eventTitle, setEventTitle] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [selectedTheme, setSelectedTheme] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [isVirtual, setIsVirtual] = useState(true);
  const [venue, setVenue] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  
  // Capacity
  const [maxMen, setMaxMen] = useState("12");
  const [maxWomen, setMaxWomen] = useState("12");
  
  // Dynamic Pricing
  const [priceMen, setPriceMen] = useState("25.00");
  const [priceWomen, setPriceWomen] = useState("10.00");
  
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePublish = async () => {
    if (!eventTitle || !selectedTheme || !eventDate || !eventTime) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsPublishing(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setIsPublishing(false);
    
    toast.success("Event Live! 🎉", {
      description: "Ticket sales are now enabled",
    });
    
    navigate("/events");
  };

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <div className="sticky top-0 z-40 glass-card border-b border-border/50 rounded-none">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-lg font-bold text-foreground">Create Event</h1>
              <p className="text-xs text-muted-foreground">Admin Command Center</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-2">
            <Eye className="w-4 h-4" />
            Preview
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Section: Basic Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-foreground">Vibe & Theme</h2>
          </div>

          {/* Theme Selector */}
          <div className="grid grid-cols-2 gap-3">
            {eventThemes.map((theme) => (
              <motion.button
                key={theme.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedTheme(theme.id)}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  selectedTheme === theme.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-border/80 bg-secondary/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl">{theme.emoji}</span>
                  <div
                    className={`w-3 h-3 rounded-full bg-gradient-to-br ${theme.color}`}
                  />
                </div>
                <p className="text-sm font-medium text-foreground">{theme.label}</p>
              </motion.button>
            ))}
          </div>

          {/* Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Event Title</label>
            <Input
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              placeholder="e.g., Techno & Tech: Developer Speed Dating"
              className="bg-secondary/50"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Description</label>
            <Textarea
              value={eventDescription}
              onChange={(e) => setEventDescription(e.target.value)}
              placeholder="Tell guests what to expect..."
              className="bg-secondary/50 min-h-[100px]"
            />
          </div>

          {/* Cover Image */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Cover Image URL</label>
            <div className="flex gap-2">
              <Input
                value={coverImage}
                onChange={(e) => setCoverImage(e.target.value)}
                placeholder="https://..."
                className="bg-secondary/50"
              />
              <Button variant="outline" size="icon">
                <Image className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Section: Logistics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-cyan-400" />
            <h2 className="font-semibold text-foreground">Logistics</h2>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                Date
              </label>
              <Input
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="bg-secondary/50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                Time
              </label>
              <Input
                type="time"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                className="bg-secondary/50"
              />
            </div>
          </div>

          {/* Virtual Toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/30">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isVirtual 
                  ? "bg-gradient-to-br from-primary to-accent" 
                  : "bg-gradient-to-br from-orange-500 to-red-500"
              }`}>
                {isVirtual ? (
                  <Video className="w-5 h-5 text-white" />
                ) : (
                  <MapPin className="w-5 h-5 text-white" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {isVirtual ? "Virtual Event" : "In-Person Event"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isVirtual ? "Video speed dating" : "Physical venue"}
                </p>
              </div>
            </div>
            <Switch
              checked={isVirtual}
              onCheckedChange={setIsVirtual}
            />
          </div>

          {/* Venue (if not virtual) */}
          {!isVirtual && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="space-y-2"
            >
              <label className="text-sm font-medium text-foreground">Venue Name & Address</label>
              <Input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="The Digital Lounge, 123 Innovation St"
                className="bg-secondary/50"
              />
            </motion.div>
          )}
        </motion.div>

        {/* Section: Audience & Pricing */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-5 h-5 text-accent" />
            <h2 className="font-semibold text-foreground">Audience & Pricing</h2>
          </div>

          {/* Gender Capacity */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">Gender Capacity</label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-sm text-foreground">Max Men</span>
                </div>
                <Input
                  type="number"
                  value={maxMen}
                  onChange={(e) => setMaxMen(e.target.value)}
                  className="bg-secondary/50"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-pink-500" />
                  <span className="text-sm text-foreground">Max Women</span>
                </div>
                <Input
                  type="number"
                  value={maxWomen}
                  onChange={(e) => setMaxWomen(e.target.value)}
                  className="bg-secondary/50"
                />
              </div>
            </div>
          </div>

          {/* Dynamic Pricing */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-500" />
              <label className="text-sm font-medium text-muted-foreground">
                Dynamic Pricing Engine
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="p-4 rounded-xl border-2 border-blue-500/30 bg-blue-500/5">
                  <div className="flex items-center gap-2 mb-3">
                    <DollarSign className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-medium text-blue-400">Price for Men</span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 font-medium">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      value={priceMen}
                      onChange={(e) => setPriceMen(e.target.value)}
                      className="pl-8 bg-blue-500/10 border-blue-500/30 text-foreground font-semibold text-lg"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="p-4 rounded-xl border-2 border-pink-500/30 bg-pink-500/5">
                  <div className="flex items-center gap-2 mb-3">
                    <DollarSign className="w-4 h-4 text-pink-400" />
                    <span className="text-sm font-medium text-pink-400">Price for Women</span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-pink-400 font-medium">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      value={priceWomen}
                      onChange={(e) => setPriceWomen(e.target.value)}
                      className="pl-8 bg-pink-500/10 border-pink-500/30 text-foreground font-semibold text-lg"
                    />
                  </div>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Set different prices to balance your gender ratio
            </p>
          </div>
        </motion.div>

        {/* Revenue Preview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-card rounded-2xl p-6"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Potential Revenue (Full Capacity)</p>
              <p className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                ${(
                  parseFloat(priceMen || "0") * parseInt(maxMen || "0") +
                  parseFloat(priceWomen || "0") * parseInt(maxWomen || "0")
                ).toFixed(2)}
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>{maxMen} × ${priceMen} = ${(parseFloat(priceMen || "0") * parseInt(maxMen || "0")).toFixed(2)}</p>
              <p>{maxWomen} × ${priceWomen} = ${(parseFloat(priceWomen || "0") * parseInt(maxWomen || "0")).toFixed(2)}</p>
            </div>
          </div>
        </motion.div>

        {/* Publish Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Button
            variant="gradient"
            size="xl"
            className="w-full"
            onClick={handlePublish}
            disabled={isPublishing}
          >
            {isPublishing ? (
              <span className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full"
                />
                Publishing...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Save className="w-5 h-5" />
                Publish Event
              </span>
            )}
          </Button>
        </motion.div>
      </div>
    </div>
  );
};

export default AdminCreateEvent;
