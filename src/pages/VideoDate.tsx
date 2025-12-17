import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Mic, MicOff, Video, VideoOff, PhoneOff, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const VideoDate = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
  const [showFeedback, setShowFeedback] = useState(false);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setShowFeedback(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  const handleVibe = (vibed: boolean) => {
    setShowFeedback(false);
    if (vibed) {
      toast.success("It's a match! 🎉 You can now chat with Emma.");
    } else {
      toast("No worries! Your next date is starting...");
    }
    navigate("/dashboard");
  };

  const handleLeave = () => {
    navigate("/dashboard");
    toast("You left the date early");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Timer Bar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
        <div className="glass-card px-6 py-3 flex items-center gap-3 neon-glow-violet">
          <Clock className="w-5 h-5 text-primary" />
          <span className="text-xl font-display font-bold text-foreground">
            {formatTime(timeLeft)}
          </span>
          <span className="text-sm text-muted-foreground">remaining</span>
        </div>
      </div>

      {/* Main Video (Partner) */}
      <div className="flex-1 relative bg-secondary">
        <img
          src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800"
          alt="Partner"
          className="w-full h-full object-cover"
        />
        
        {/* Partner Name */}
        <div className="absolute bottom-24 left-4 glass-card px-4 py-2">
          <p className="font-semibold text-foreground">Emma, 26</p>
          <p className="text-xs text-muted-foreground">Music Lover • Traveler</p>
        </div>

        {/* Self View (PIP) */}
        <div className="absolute top-20 right-4 w-28 h-40 rounded-2xl overflow-hidden border-2 border-white/20 shadow-xl">
          {isVideoOff ? (
            <div className="w-full h-full bg-secondary flex items-center justify-center">
              <VideoOff className="w-8 h-8 text-muted-foreground" />
            </div>
          ) : (
            <img
              src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300"
              alt="You"
              className="w-full h-full object-cover"
            />
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background/80 to-transparent">
        <div className="flex items-center justify-center gap-4">
          <Button
            variant={isMuted ? "destructive" : "glass"}
            size="icon"
            className="h-14 w-14 rounded-full"
            onClick={() => setIsMuted(!isMuted)}
          >
            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </Button>

          <Button
            variant="destructive"
            size="icon"
            className="h-16 w-16 rounded-full"
            onClick={handleLeave}
          >
            <PhoneOff className="w-6 h-6" />
          </Button>

          <Button
            variant={isVideoOff ? "destructive" : "glass"}
            size="icon"
            className="h-14 w-14 rounded-full"
            onClick={() => setIsVideoOff(!isVideoOff)}
          >
            {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
          </Button>
        </div>
      </div>

      {/* Feedback Modal */}
      <Dialog open={showFeedback} onOpenChange={setShowFeedback}>
        <DialogContent className="glass-card border-white/10 max-w-sm mx-auto">
          <DialogHeader className="text-center space-y-4">
            <div className="w-20 h-20 mx-auto rounded-full overflow-hidden border-4 border-primary neon-glow-violet">
              <img
                src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200"
                alt="Emma"
                className="w-full h-full object-cover"
              />
            </div>
            <DialogTitle className="text-2xl font-display">
              Did you vibe with Emma?
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              If you both say yes, you'll be able to chat!
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-4 mt-4">
            <Button
              variant="outline"
              className="flex-1 h-14"
              onClick={() => handleVibe(false)}
            >
              Not this time
            </Button>
            <Button
              variant="gradient"
              className="flex-1 h-14"
              onClick={() => handleVibe(true)}
            >
              Yes! 💜
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VideoDate;
