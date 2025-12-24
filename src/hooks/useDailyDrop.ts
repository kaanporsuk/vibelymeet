import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { dailyDropService } from '@/services/vibelyService';
import { 
  DailyDrop, 
  DropZoneState, 
  DropHistory,
  DROP_HOUR 
} from '@/types/dailyDrop';

function isDropTimeReached(): boolean {
  const now = new Date();
  return now.getHours() >= DROP_HOUR;
}

function getTimeUntilNextDrop(): { hours: number; minutes: number; seconds: number } {
  const now = new Date();
  let targetTime: Date;
  
  if (now.getHours() >= DROP_HOUR) {
    // Next drop is tomorrow
    targetTime = new Date(now);
    targetTime.setDate(targetTime.getDate() + 1);
    targetTime.setHours(DROP_HOUR, 0, 0, 0);
  } else {
    // Today's drop
    targetTime = new Date(now);
    targetTime.setHours(DROP_HOUR, 0, 0, 0);
  }
  
  const diff = targetTime.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  
  return { hours, minutes, seconds };
}

export function useDailyDrop() {
  const { user } = useAuth();
  const [state, setState] = useState<DropZoneState>('locked');
  const [currentDrop, setCurrentDrop] = useState<DailyDrop | null>(null);
  const [countdown, setCountdown] = useState(getTimeUntilNextDrop());
  const [history, setHistory] = useState<DropHistory>({ seenUserIds: [], lastDropDate: '' });
  const [isLoading, setIsLoading] = useState(true);

  // Initialize drop state from database
  useEffect(() => {
    const initializeDrop = async () => {
      if (!user) {
        setState('locked');
        setIsLoading(false);
        return;
      }

      try {
        // Check for existing drop today
        const existingDrop = await dailyDropService.getTodaysDrop(user.id);
        
        if (existingDrop) {
          setCurrentDrop(existingDrop);
          
          if (existingDrop.status === 'replied') {
            setState('pending');
          } else if (existingDrop.status === 'viewed') {
            setState('reveal');
          } else if (existingDrop.status === 'passed') {
            setState('locked');
          } else {
            setState('ready');
          }
        } else if (isDropTimeReached()) {
          // No drop yet today, check if we can generate one
          setState('ready');
        } else {
          setState('locked');
        }

        // Load history
        const dropHistory = dailyDropService.getDropHistory(user.id);
        setHistory(dropHistory);
      } catch (error) {
        console.error('Failed to initialize daily drop:', error);
        setState('locked');
      } finally {
        setIsLoading(false);
      }
    };

    initializeDrop();
  }, [user]);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(getTimeUntilNextDrop());
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);

  // Unlock and view the drop
  const unlockDrop = useCallback(async () => {
    if (!user) return;

    try {
      // First check if we already have today's drop
      let drop = await dailyDropService.getTodaysDrop(user.id);
      
      if (!drop) {
        // Generate a new drop
        drop = await dailyDropService.generateDrop(user.id);
      }
      
      if (!drop) {
        setState('empty');
        return;
      }
      
      // Mark as viewed
      dailyDropService.updateDropStatus(user.id, drop.id, 'viewed');
      dailyDropService.recordSeenUser(user.id, drop.candidate.id, 'viewed');
      
      setCurrentDrop({ ...drop, status: 'viewed' });
      setState('reveal');
      
      // Update local history
      setHistory(prev => ({
        seenUserIds: [...prev.seenUserIds, drop!.candidate.id],
        lastDropDate: new Date().toISOString().split('T')[0],
        todayDropId: drop!.id
      }));
    } catch (error) {
      console.error('Failed to unlock drop:', error);
    }
  }, [user]);

  // Send vibe reply
  const sendVibeReply = useCallback(async (videoUrl?: string) => {
    if (!currentDrop || !user) return;
    
    dailyDropService.updateDropStatus(user.id, currentDrop.id, 'replied');
    dailyDropService.recordSeenUser(user.id, currentDrop.candidate.id, 'replied');
    
    setCurrentDrop({
      ...currentDrop,
      status: 'replied',
      replySentAt: new Date().toISOString()
    });
    setState('pending');
  }, [currentDrop, user]);

  // Pass on the drop
  const passDrop = useCallback(async () => {
    if (!currentDrop || !user) return;
    
    dailyDropService.updateDropStatus(user.id, currentDrop.id, 'passed');
    dailyDropService.recordSeenUser(user.id, currentDrop.candidate.id, 'passed');
    
    setCurrentDrop({
      ...currentDrop,
      status: 'passed'
    });
    setState('locked');
  }, [currentDrop, user]);

  // Get time remaining until drop expires
  const getExpiryCountdown = useCallback(() => {
    if (!currentDrop) return { hours: 0, minutes: 0 };
    
    const now = new Date();
    const expires = new Date(currentDrop.expiresAt);
    const diff = expires.getTime() - now.getTime();
    
    if (diff <= 0) return { hours: 0, minutes: 0 };
    
    return {
      hours: Math.floor(diff / (1000 * 60 * 60)),
      minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    };
  }, [currentDrop]);

  // Reset for testing
  const resetHistory = useCallback(() => {
    if (!user) return;
    
    dailyDropService.resetHistory(user.id);
    setHistory({ seenUserIds: [], lastDropDate: '' });
    setState('ready');
    setCurrentDrop(null);
  }, [user]);

  return {
    state,
    currentDrop,
    countdown,
    isLoading,
    unlockDrop,
    sendVibeReply,
    passDrop,
    getExpiryCountdown,
    resetHistory,
    isDropTimeReached: isDropTimeReached()
  };
}
