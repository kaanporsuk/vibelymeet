import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { useDailyDrop } from '@/hooks/useDailyDrop';
import { DropZoneWidget } from './DropZoneWidget';
import { DropRevealScreen } from './DropRevealScreen';
import { VibeSentSuccess } from './VibeSentSuccess';
import { Button } from '@/components/ui/button';

export function DailyDropSection() {
  const navigate = useNavigate();
  const {
    state,
    currentDrop,
    countdown,
    unlockDrop,
    sendVibeReply,
    passDrop,
    resetHistory
  } = useDailyDrop();

  const [showSuccess, setShowSuccess] = useState(false);

  const handleSendReply = () => {
    sendVibeReply();
    setShowSuccess(true);
  };

  const handleOpenVibeStudio = () => {
    // In a real app, this would open the camera modal
    console.log('Opening Vibe Studio...');
  };

  const handleSuccessContinue = () => {
    setShowSuccess(false);
  };

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
          onSendReply={handleSendReply}
          onPass={passDrop}
          onOpenVibeStudio={handleOpenVibeStudio}
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
        {/* Dev/Test: Reset button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={resetHistory}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="w-3 h-3 mr-1" />
          Reset
        </Button>
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
