import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  Sparkles, 
  Share2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import VenueCard from "@/components/events/VenueCard";
import MiniProfileModal from "@/components/events/MiniProfileModal";
import TicketStub from "@/components/events/TicketStub";
import GuestListTeaser from "@/components/events/GuestListTeaser";
import GuestListRoster from "@/components/events/GuestListRoster";
import PricingBar from "@/components/events/PricingBar";
import PaymentModal from "@/components/events/PaymentModal";
import ManageBookingModal from "@/components/events/ManageBookingModal";
import CancelBookingModal from "@/components/events/CancelBookingModal";

// Mock user data
const mockUser = {
  id: "current-user",
  gender: "Male" as const,
};

// Mock event data with pricing
const mockEvent = {
  id: "1",
  title: "Techno & Tech: Developer Speed Dating",
  description: "Join fellow developers and tech enthusiasts for an electrifying evening of speed dating! Whether you code by day and dance by night, or you're just looking to meet someone who gets your Stack Overflow references, this is your event. Each round lasts 5 minutes with curated ice-breakers designed for techies. Dress code: Smart casual (band tees allowed). Expect: Great vibes, craft cocktails, and maybe your next commit partner.",
  coverImage: "https://images.unsplash.com/photo-1574391884720-bbc3740c59d1?w=800&q=80",
  category: "🕹️ Tech & Gaming",
  vibeMatch: 92,
  eventDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  time: "7:00 PM - 10:00 PM",
  isVirtual: true,
  venue: "The Digital Lounge",
  address: "123 Innovation St, Tech City",
  priceMale: 25.00,
  priceFemale: 10.00,
  maxMen: 12,
  maxWomen: 12,
  currentMen: 8,
  currentWomen: 10,
  tags: ["🎧 Electronic", "💻 Tech", "⚡ Speed Date"],
};

// Mock attendees for teaser (before purchase)
const mockTeaserAttendees = [
  { id: "1", name: "???", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80", vibeTags: ["🎵 Techno Lover", "☕ Coffee Snob"] },
  { id: "2", name: "???", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80", vibeTags: ["🎨 Creative", "📚 Bookworm"] },
  { id: "3", name: "???", avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80", vibeTags: ["🍳 Foodie", "✈️ Traveler"] },
  { id: "4", name: "???", avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80", vibeTags: ["🧘 Wellness", "🎬 Film Buff"] },
  { id: "5", name: "???", avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80", vibeTags: ["🎮 Gamer", "💻 Tech"] },
  { id: "6", name: "???", avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&q=80", vibeTags: ["📸 Photography", "🌿 Nature"] },
];

// Mock attendees for roster (after purchase)
const mockRosterAttendees = [
  { id: "1", name: "Alex Chen", age: 28, avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80", vibeTag: "Night Owl", matchPercent: 92, bio: "Senior dev by day, DJ by night", photos: [] },
  { id: "2", name: "Sarah Kim", age: 26, avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80", vibeTag: "Creative Soul", matchPercent: 88, bio: "UX designer who loves hiking", photos: [] },
  { id: "3", name: "Marcus Johnson", age: 31, avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80", vibeTag: "Foodie", matchPercent: 75, bio: "Startup founder, amateur chef", photos: [] },
  { id: "4", name: "Emma Watson", age: 27, avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80", vibeTag: "Intellectual", matchPercent: 95, bio: "Data scientist who loves board games", photos: [] },
  { id: "5", name: "James Liu", age: 29, avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80", vibeTag: "Gamer", matchPercent: 82, bio: "Frontend wizard, anime enthusiast", photos: [] },
  { id: "6", name: "Olivia Brown", age: 25, avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&q=80", vibeTag: "Wanderer", matchPercent: 79, bio: "Product manager with a passion for travel", photos: [] },
];

const EventDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  
  // Registration state
  const [isRegistered, setIsRegistered] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  
  // Modal states
  const [selectedProfile, setSelectedProfile] = useState<typeof mockRosterAttendees[0] | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showManageBooking, setShowManageBooking] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showTicket, setShowTicket] = useState(false);

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

  // Calculate capacity status
  const getCapacityStatus = () => {
    const spotsLeft = mockUser.gender === "Male" 
      ? mockEvent.maxMen - mockEvent.currentMen 
      : mockEvent.maxWomen - mockEvent.currentWomen;
    
    if (spotsLeft <= 2) return { status: "almostFull" as const, spotsLeft };
    if (spotsLeft <= 5) return { status: "filling" as const, spotsLeft };
    return { status: "available" as const, spotsLeft };
  };

  const capacityInfo = getCapacityStatus();
  const userPrice = mockUser.gender === "Male" ? mockEvent.priceMale : mockEvent.priceFemale;

  const handlePaymentSuccess = () => {
    setShowPaymentModal(false);
    setIsRegistered(true);
    
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#a855f7", "#ec4899", "#06b6d4"],
    });

    toast.success("You're on the list! 🎉", {
      description: "Check your email for confirmation",
    });

    setTimeout(() => setShowTicket(true), 800);
  };

  const handleCancelConfirm = () => {
    setShowCancelModal(false);
    setShowManageBooking(false);
    setIsRegistered(false);
    
    toast.success("Spot cancelled", {
      description: "Your spot has been released to the waitlist",
    });
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

        {/* Guest List - Conditional Rendering */}
        <AnimatePresence mode="wait">
          {isRegistered ? (
            <motion.div
              key="roster"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <GuestListRoster
                attendees={mockRosterAttendees}
                totalCount={mockEvent.currentMen + mockEvent.currentWomen}
                onAttendeeClick={setSelectedProfile}
                onTicketClick={() => setShowManageBooking(true)}
              />
            </motion.div>
          ) : (
            <motion.div
              key="teaser"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <GuestListTeaser
                attendees={mockTeaserAttendees}
                totalCount={mockEvent.currentMen + mockEvent.currentWomen}
              />
            </motion.div>
          )}
        </AnimatePresence>

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

      {/* Sticky Bottom Bar - Only show when not registered */}
      {!isRegistered && (
        <PricingBar
          price={userPrice}
          capacityStatus={capacityInfo.status}
          spotsLeft={capacityInfo.spotsLeft}
          genderLabel={mockUser.gender}
          onPurchase={() => setShowPaymentModal(true)}
        />
      )}

      {/* Registered Bottom Bar */}
      {isRegistered && (
        <div className="fixed bottom-0 left-0 right-0 z-40 glass-card border-t border-border/50 rounded-none">
          <div className="max-w-lg mx-auto p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-10 h-10 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center"
              >
                <Sparkles className="w-5 h-5 text-white" />
              </motion.div>
              <div>
                <p className="font-semibold text-foreground">You're In!</p>
                <p className="text-xs text-muted-foreground">See you there</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => setShowManageBooking(true)}>
              Manage Booking
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSuccess={handlePaymentSuccess}
        eventTitle={mockEvent.title}
        eventDate={formatDate(mockEvent.eventDate)}
        userGender={mockUser.gender}
        priceMale={mockEvent.priceMale}
        priceFemale={mockEvent.priceFemale}
      />

      <ManageBookingModal
        isOpen={showManageBooking}
        onClose={() => setShowManageBooking(false)}
        onCancel={() => {
          setShowManageBooking(false);
          setShowCancelModal(true);
        }}
        eventTitle={mockEvent.title}
        eventDate={formatDate(mockEvent.eventDate)}
        eventTime={mockEvent.time}
        venue={mockEvent.venue}
        ticketNumber="VBL-2024-001"
        price={userPrice}
      />

      <CancelBookingModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancelConfirm}
        eventTitle={mockEvent.title}
      />

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
