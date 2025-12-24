import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, Loader2 } from 'lucide-react';
import { useDailyDrop } from '@/hooks/useDailyDrop';
import { DropZoneWidget } from './DropZoneWidget';
import { DropRevealScreen } from './DropRevealScreen';
import { VibeSentSuccess } from './VibeSentSuccess';
import { VibeReplyModal } from './VibeReplyModal';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

export function DailyDropSection() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    state,
    currentDrop,
    countdown,
    isLoading,
    unlockDrop,
    sendVibeReply,
    passDrop,
    resetHistory
  } = useDailyDrop();

  const [showSuccess, setShowSuccess] = useState(false);
  const [showVibeReplyModal, setShowVibeReplyModal] = useState(false);

  const handleOpenVibeStudio = () => {
    setShowVibeReplyModal(true);
  };

  const handleSendVibeReply = (videoBlob: Blob | null) => {
    if (videoBlob) {
      console.log('Video recorded:', videoBlob.size, 'bytes');
      toast.success('Recording your vibe reply...');
    }
    sendVibeReply();
    setShowVibeReplyModal(false);
    setShowSuccess(true);
  };

  const handleSuccessContinue = () => {
    setShowSuccess(false);
  };

  // Show loading state
  if (isLoading) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-display font-semibold text-foreground">
          Daily Drop
        </h2>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  // Show success screen
  if (showSuccess && currentDrop) {
    return (
      <VibeSentSuccess
        matchName={currentDrop.candidate.name}
        onContinue={handleSuccessContinue}
      />
    );
  }

  // Show reveal screen
  if (state === 'reveal' && currentDrop) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-display font-semibold text-foreground">
            Your Daily Drop
          </h2>
        </div>
        <DropRevealScreen
          drop={currentDrop}
          onSendReply={handleOpenVibeStudio}
          onPass={passDrop}
          onOpenVibeStudio={handleOpenVibeStudio}
        />
        
        {/* Vibe Reply Modal */}
        <VibeReplyModal
          open={showVibeReplyModal}
          onOpenChange={setShowVibeReplyModal}
          recipientName={currentDrop.candidate.name}
          recipientAvatar={currentDrop.candidate.avatarUrl}
          onSendReply={handleSendVibeReply}
          maxDuration={15}
        />
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display font-semibold text-foreground">
          Daily Drop
        </h2>
        {/* Dev/Test: Reset button - only show for authenticated users */}
        {user && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetHistory}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset
          </Button>
        )}
      </div>
      
      <DropZoneWidget
        state={state}
        countdown={countdown}
        pendingName={currentDrop?.candidate.name}
        pendingAvatar={currentDrop?.candidate.avatarUrl}
        onUnlock={unlockDrop}
        onViewEvents={() => navigate('/events')}
      />
    </section>
  );
}
