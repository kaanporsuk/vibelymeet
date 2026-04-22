import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import MatchSuccessModal from "@/components/match/MatchSuccessModal";

/**
 * Demo page to showcase the Match Celebration modal
 * In production, this modal would be triggered from the Video Date checkpoint
 */
const MatchCelebration = () => {
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // Trigger the modal after a brief delay to simulate the checkpoint result
    const timer = setTimeout(() => {
      setShowModal(true);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setShowModal(false);
    // Navigate back to events after closing
    setTimeout(() => {
      navigate("/events");
    }, 300);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      {/* Background context - what user was doing before */}
      <div className="text-center text-muted-foreground">
        <p className="text-lg">Processing your Vibe Check results...</p>
      </div>

      {/* The celebration modal */}
      <MatchSuccessModal
        isOpen={showModal}
        onClose={handleClose}
        onStartChatting={() => navigate("/matches")}
        matchData={{
          name: "Sarah",
          age: 24,
          avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
          sharedVibes: ["🦉 Night Owl", "🎨 Design", "🍕 Pizza"],
          vibeScore: 94,
        }}
        userData={{
          name: "You",
          avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
        }}
      />
    </div>
  );
};

export default MatchCelebration;
