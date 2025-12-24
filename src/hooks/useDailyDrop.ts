import { useState, useEffect, useCallback } from 'react';
import { 
  MatchCandidate, 
  DailyDrop, 
  DropZoneState, 
  DropHistory,
  getDailyDropCandidate,
  DROP_HOUR 
} from '@/types/dailyDrop';

const STORAGE_KEY = 'vibely_drop_history';

// Mock users with varied activity levels
const MOCK_CANDIDATES: MatchCandidate[] = [
  {
    id: 'drop-1',
    name: 'Maya',
    age: 26,
    lastActiveAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400',
    vibeTags: ['Creative Soul', 'Night Owl', 'Foodie'],
    bio: 'Artist by day, stargazer by night. Looking for someone who appreciates the beauty in chaos.',
    location: 'Brooklyn, NY'
  },
  {
    id: 'drop-2',
    name: 'Jordan',
    age: 28,
    lastActiveAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6h ago
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400',
    vibeTags: ['Adventure Seeker', 'Dog Parent', 'Coffee Snob'],
    bio: 'Weekend hiker, weekday coder. My dog is my best wingman.',
    location: 'Austin, TX'
  },
  {
    id: 'drop-3',
    name: 'Aria',
    age: 25,
    lastActiveAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12h ago
    avatarUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400',
    vibeTags: ['Bookworm', 'Wine Lover', 'Plant Parent'],
    bio: 'Currently reading: too many books at once. Plant collection: also too many.',
    location: 'Seattle, WA'
  },
  {
    id: 'drop-4',
    name: 'Marcus',
    age: 30,
    lastActiveAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 24h ago
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400',
    vibeTags: ['Musician', 'Vinyl Collector', 'Homebody'],
    bio: 'Jazz enthusiast. Making playlists for every mood. Let me make one for you.',
    location: 'Chicago, IL'
  },
  // Old user - should NOT appear (5 days ago)
  {
    id: 'old-user-test',
    name: 'Ghost User',
    age: 27,
    lastActiveAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400',
    vibeTags: ['Inactive', 'Test'],
    bio: 'This user should never appear in drops.',
    location: 'Nowhere'
  }
];

function getStoredHistory(): DropHistory {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to parse drop history', e);
  }
  return { seenUserIds: [], lastDropDate: '' };
}

function saveHistory(history: DropHistory): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

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

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

export function useDailyDrop() {
  const [state, setState] = useState<DropZoneState>('locked');
  const [currentDrop, setCurrentDrop] = useState<DailyDrop | null>(null);
  const [countdown, setCountdown] = useState(getTimeUntilNextDrop());
  const [history, setHistory] = useState<DropHistory>(getStoredHistory);

  // Initialize drop state
  useEffect(() => {
    const todayKey = getTodayKey();
    const storedHistory = getStoredHistory();
    
    // Check if we already have a drop for today
    if (storedHistory.lastDropDate === todayKey && storedHistory.todayDropId) {
      // Already viewed today
      setState('locked');
    } else if (isDropTimeReached()) {
      // Time to show a new drop
      const candidate = getDailyDropCandidate(MOCK_CANDIDATES, storedHistory.seenUserIds);
      
      if (candidate) {
        setState('ready');
      } else {
        setState('empty');
      }
    } else {
      setState('locked');
    }
    
    setHistory(storedHistory);
  }, []);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(getTimeUntilNextDrop());
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);

  // Unlock and view the drop
  const unlockDrop = useCallback(() => {
    const candidate = getDailyDropCandidate(MOCK_CANDIDATES, history.seenUserIds);
    
    if (!candidate) {
      setState('empty');
      return;
    }
    
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    const drop: DailyDrop = {
      id: `drop-${Date.now()}`,
      candidate,
      droppedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'viewed'
    };
    
    setCurrentDrop(drop);
    setState('reveal');
    
    // Update history
    const newHistory: DropHistory = {
      seenUserIds: [...history.seenUserIds, candidate.id],
      lastDropDate: getTodayKey(),
      todayDropId: drop.id
    };
    setHistory(newHistory);
    saveHistory(newHistory);
  }, [history]);

  // Send vibe reply
  const sendVibeReply = useCallback(() => {
    if (!currentDrop) return;
    
    setCurrentDrop({
      ...currentDrop,
      status: 'replied',
      replySentAt: new Date().toISOString()
    });
    setState('pending');
  }, [currentDrop]);

  // Pass on the drop
  const passDrop = useCallback(() => {
    if (!currentDrop) return;
    
    setCurrentDrop({
      ...currentDrop,
      status: 'passed'
    });
    setState('locked');
  }, [currentDrop]);

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
    localStorage.removeItem(STORAGE_KEY);
    setHistory({ seenUserIds: [], lastDropDate: '' });
    setState('ready');
    setCurrentDrop(null);
  }, []);

  return {
    state,
    currentDrop,
    countdown,
    unlockDrop,
    sendVibeReply,
    passDrop,
    getExpiryCountdown,
    resetHistory,
    isDropTimeReached: isDropTimeReached()
  };
}
