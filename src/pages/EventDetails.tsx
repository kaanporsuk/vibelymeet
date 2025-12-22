import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  Sparkles, 
  AlertTriangle,
  Ticket,
  Check,
  Share2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import WhosGoingSection from "@/components/events/WhosGoingSection";
import VenueCard from "@/components/events/VenueCard";
import MiniProfileModal from "@/components/events/MiniProfileModal";
import TicketStub from "@/components/events/TicketStub";

// Mock event data
const mockEvent = {
  id: "1",
  title: "Techno & Tech: Developer Speed Dating",
  description: "Join fellow developers and tech enthusiasts for an electrifying evening of speed dating! Whether you code by day and dance by night, or you're just looking to meet someone who gets your Stack Overflow references, this is your event. Each round lasts 5 minutes with curated ice-breakers designed for techies. Dress code: Smart casual (band tees allowed). Expect: Great vibes, craft cocktails, and maybe your next commit partner.",
  coverImage: "https://images.unsplash.com/photo-1574391884720-bbc3740c59d1?w=800&q=80",
  category: "🕹️ Tech & Gaming",
  vibeMatch: 92,
  eventDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
  time: "7:00 PM - 10:00 PM",
  isVirtual: true,
  venue: "The Digital Lounge",
  address: "123 Innovation St, Tech City",
  price: "Free",
  spotsLeft: 4,
  totalSpots: 24,
  genderBalance: "Women",
  tags: ["🎧 Electronic", "💻 Tech", "⚡ Speed Date"],
};

const mockAttendees = [
  {
    id: "1",
    name: "Alex Chen",
    age: 28,
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80",
    bio: "Senior dev by day, DJ by night. Looking for someone to debug my heart 💔→❤️",
    vibeTag: "Night Owl",
    photos: ["https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80"],
  },
  {
    id: "2",
    name: "Sarah Kim",
    age: 26,
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80",
    bio: "UX designer who loves hiking and craft coffee. Let's explore the city together!",
    vibeTag: "Creative Soul",
    photos: ["https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&q=80"],
  },
  {
    id: "3",
    name: "Marcus Johnson",
    age: 31,
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80",
    bio: "Startup founder, amateur chef. I make a mean pasta carbonara 🍝",
    vibeTag: "Foodie",
    photos: ["https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80"],
  },
  {
    id: "4",
    name: "Emma Watson",
    age: 27,
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80",
    bio: "Data scientist who loves board games and deep conversations.",
    vibeTag: "Intellectual",
    photos: ["https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&q=80"],
  },
  {
    id: "5",
    name: "James Liu",
    age: 29,
    avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80",
    bio: "Frontend wizard, anime enthusiast. Looking for my co-op partner.",
    vibeTag: "Gamer",
    photos: ["https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&q=80"],
  },
  {
    id: "6",
    name: "Olivia Brown",
    age: 25,
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&q=80",
    bio: "Product manager with a passion for travel and photography 📸",
    vibeTag: "Wanderer",
    photos: ["https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80"],
  },
];

const EventDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [isRegistered, setIsRegistered] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<typeof mockAttendees[0] | null>(null);
  const [showTicket, setShowTicket] = useState(false);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  const handleRegister = async () => {
    setIsRegistering(true);
    
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    setIsRegistering(false);
    setIsRegistered(true);
    
    // Confetti burst
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#a855f7", "#ec4899", "#06b6d4"],
    });

    toast.success("You're on the list! 🎉", {
      description: "Check your email for confirmation",
    });

    // Show ticket after a brief delay
    setTimeout(() => setShowTicket(true), 800);
  };

  const handleShare = async () => {
    try {
      await navigator.share({
        title: mockEvent.title,
        text: `Join me at ${mockEvent.title} on Vibely!`,
        url: window.location.href,
      });
    } catch {
      toast.success("Link copied to clipboard!");
    }
  };

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Parallax Hero */}
      <div className="relative h-[50vh] overflow-hidden">
        <motion.div
          style={{ y: scrollY * 0.5 }}
          className="absolute inset-0"
        >
          <img
            src={mockEvent.coverImage}
            alt={mockEvent.title}
            className="w-full h-full object-cover scale-110"
          />
        </motion.div>

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />

        {/* Top Bar */}
        <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-10">
          <Button
            variant="glass"
            size="icon"
            onClick={() => navigate("/events")}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <Button variant="glass" size="icon" onClick={handleShare}>
            <Share2 className="w-5 h-5" />
          </Button>
        </div>

        {/* Hero Content */}
        <div className="absolute bottom-0 left-0 right-0 p-6 space-y-3">
          {/* Category & Match */}
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full bg-secondary text-sm font-medium text-foreground">
              {mockEvent.category}
            </span>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="px-3 py-1 rounded-full bg-gradient-to-r from-primary to-accent flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3 text-primary-foreground" />
              <span className="text-xs font-bold text-primary-foreground">
                {mockEvent.vibeMatch}% Match
              </span>
            </motion.div>
          </div>

          <h1 className="text-2xl font-bold text-foreground leading-tight">
            {mockEvent.title}
          </h1>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              <span>{formatDate(mockEvent.eventDate)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>{mockEvent.time}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-6 space-y-6">
        {/* Tags */}
        <div className="flex gap-2 flex-wrap">
          {mockEvent.tags.map((tag) => (
            <span
              key={tag}
              className="px-3 py-1 rounded-full bg-primary/10 border border-primary/30 text-sm font-medium text-primary"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">About This Event</h2>
          <p className="text-muted-foreground leading-relaxed">
            {mockEvent.description}
          </p>
        </div>

        {/* Who's Going */}
        <WhosGoingSection
          attendees={mockAttendees}
          totalCount={mockEvent.totalSpots - mockEvent.spotsLeft}
          onAttendeeClick={setSelectedProfile}
        />

        {/* Venue */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">The Venue</h2>
          <VenueCard
            isVirtual={mockEvent.isVirtual}
            venueName={mockEvent.venue}
            address={mockEvent.address}
            eventDate={mockEvent.eventDate}
          />
        </div>
      </div>

      {/* Sticky Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 glass-card border-t border-border rounded-none z-40">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
          {/* Price & Spots */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-foreground">{mockEvent.price}</span>
              {mockEvent.spotsLeft <= 5 && (
                <span className="px-2 py-0.5 rounded-full bg-destructive/20 text-xs font-medium text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {mockEvent.spotsLeft} spots left
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              Only {mockEvent.spotsLeft} spots for {mockEvent.genderBalance}
            </span>
          </div>

          {/* CTA Button */}
          <AnimatePresence mode="wait">
            {isRegistered ? (
              <motion.div
                key="registered"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex items-center gap-2"
              >
                <Button
                  variant="outline"
                  className="gap-2 border-primary text-primary"
                  onClick={() => setShowTicket(true)}
                >
                  <Ticket className="w-4 h-4" />
                  View Ticket
                </Button>
              </motion.div>
            ) : (
              <motion.div key="register">
                <Button
                  variant="gradient"
                  size="lg"
                  onClick={handleRegister}
                  disabled={isRegistering}
                  className="relative overflow-hidden min-w-[160px]"
                >
                  <AnimatePresence mode="wait">
                    {isRegistering ? (
                      <motion.div
                        key="spinner"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2"
                      >
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full"
                        />
                        <span>Securing...</span>
                      </motion.div>
                    ) : (
                      <motion.span
                        key="text"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        Secure My Spot
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Mini Profile Modal */}
      <MiniProfileModal
        profile={selectedProfile}
        isOpen={!!selectedProfile}
        onClose={() => setSelectedProfile(null)}
      />

      {/* Ticket Stub */}
      <AnimatePresence>
        {showTicket && (
          <TicketStub
            eventTitle={mockEvent.title}
            eventDate={formatDate(mockEvent.eventDate)}
            eventTime={mockEvent.time}
            isVirtual={mockEvent.isVirtual}
            venue={mockEvent.venue}
            ticketNumber="VBL-2024-001"
            onClose={() => setShowTicket(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default EventDetails;
