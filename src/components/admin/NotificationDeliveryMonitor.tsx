import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  CheckCircle,
  Eye,
  AlertCircle,
  Zap,
  Radio,
  Pause,
  Play,
  RefreshCw,
  Smartphone,
  Monitor,
  Tablet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface NotificationEvent {
  id: string;
  userId: string;
  userName: string;
  status: 'sending' | 'sent' | 'delivered' | 'opened' | 'failed';
  timestamp: Date;
  campaignName: string;
  device: 'ios' | 'android' | 'web';
  title: string;
}

// Mock user names for demo
const mockUsers = [
  'Emma W.', 'Liam S.', 'Olivia M.', 'Noah J.', 'Ava K.', 
  'Ethan R.', 'Sophia L.', 'Mason B.', 'Isabella G.', 'Lucas P.',
  'Mia T.', 'Jackson H.', 'Charlotte D.', 'Aiden C.', 'Amelia N.',
];

const mockCampaigns = [
  'Daily Drop Reminder',
  'Re-engagement - 3 Day',
  'New Event Alert',
  'Match Notification',
  'Weekend Promo',
];

const mockTitles = [
  'Your daily vibe is waiting! 💫',
  'Someone special liked you! 💕',
  'New event this weekend! 🎉',
  'Don\'t miss your match! 💬',
  'You have a new message! 📩',
];

const NotificationDeliveryMonitor = () => {
  const [isLive, setIsLive] = useState(true);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [stats, setStats] = useState({
    sending: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    failed: 0,
    total: 0,
  });
  const [throughput, setThroughput] = useState(0);
  const eventIdCounter = useRef(0);
  const eventsRef = useRef<NotificationEvent[]>([]);
  
  // Generate random notification event
  const generateEvent = (): NotificationEvent => {
    eventIdCounter.current += 1;
    return {
      id: `evt-${eventIdCounter.current}`,
      userId: `user-${Math.floor(Math.random() * 1000)}`,
      userName: mockUsers[Math.floor(Math.random() * mockUsers.length)],
      status: 'sending',
      timestamp: new Date(),
      campaignName: mockCampaigns[Math.floor(Math.random() * mockCampaigns.length)],
      device: ['ios', 'android', 'web'][Math.floor(Math.random() * 3)] as 'ios' | 'android' | 'web',
      title: mockTitles[Math.floor(Math.random() * mockTitles.length)],
    };
  };
  
  // Progress notification through states
  const progressNotification = (eventId: string) => {
    const statuses: NotificationEvent['status'][] = ['sent', 'delivered', 'opened'];
    let currentIndex = 0;
    
    const interval = setInterval(() => {
      if (currentIndex >= statuses.length) {
        clearInterval(interval);
        return;
      }
      
      const newStatus = statuses[currentIndex];
      const shouldFail = newStatus === 'delivered' && Math.random() < 0.05; // 5% failure rate
      
      setEvents(prev => {
        const updated = prev.map(e => {
          if (e.id === eventId) {
            return { ...e, status: shouldFail ? 'failed' : newStatus };
          }
          return e;
        });
        eventsRef.current = updated;
        return updated;
      });
      
      if (shouldFail) {
        clearInterval(interval);
        setStats(prev => ({ ...prev, failed: prev.failed + 1 }));
      } else {
        setStats(prev => ({
          ...prev,
          [newStatus]: prev[newStatus] + 1,
        }));
      }
      
      // Only 60% of delivered actually get opened
      if (newStatus === 'delivered' && Math.random() > 0.6) {
        clearInterval(interval);
      }
      
      currentIndex++;
    }, 800 + Math.random() * 1500);
    
    return interval;
  };
  
  // Live event generation
  useEffect(() => {
    if (!isLive) return;
    
    const generateInterval = setInterval(() => {
      const event = generateEvent();
      
      setEvents(prev => {
        const updated = [event, ...prev].slice(0, 50); // Keep last 50 events
        eventsRef.current = updated;
        return updated;
      });
      
      setStats(prev => ({
        ...prev,
        sending: prev.sending + 1,
        total: prev.total + 1,
      }));
      
      // Progress this event through states
      setTimeout(() => {
        setEvents(prev => prev.map(e => 
          e.id === event.id ? { ...e, status: 'sent' } : e
        ));
        setStats(prev => ({ ...prev, sent: prev.sent + 1, sending: prev.sending - 1 }));
        progressNotification(event.id);
      }, 300 + Math.random() * 500);
      
    }, 400 + Math.random() * 800); // New event every 400-1200ms
    
    return () => clearInterval(generateInterval);
  }, [isLive]);
  
  // Calculate throughput
  useEffect(() => {
    const interval = setInterval(() => {
      const recentEvents = eventsRef.current.filter(
        e => new Date().getTime() - e.timestamp.getTime() < 60000
      );
      setThroughput(recentEvents.length);
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  const getStatusIcon = (status: NotificationEvent['status']) => {
    switch (status) {
      case 'sending':
        return <Send className="w-3.5 h-3.5 text-muted-foreground animate-pulse" />;
      case 'sent':
        return <CheckCircle className="w-3.5 h-3.5 text-primary" />;
      case 'delivered':
        return <CheckCircle className="w-3.5 h-3.5 text-accent" />;
      case 'opened':
        return <Eye className="w-3.5 h-3.5 text-green-400" />;
      case 'failed':
        return <AlertCircle className="w-3.5 h-3.5 text-destructive" />;
    }
  };
  
  const getDeviceIcon = (device: NotificationEvent['device']) => {
    switch (device) {
      case 'ios':
      case 'android':
        return <Smartphone className="w-3 h-3" />;
      case 'web':
        return <Monitor className="w-3 h-3" />;
    }
  };
  
  const getStatusColor = (status: NotificationEvent['status']) => {
    switch (status) {
      case 'sending':
        return 'bg-muted-foreground/20 text-muted-foreground';
      case 'sent':
        return 'bg-primary/20 text-primary';
      case 'delivered':
        return 'bg-accent/20 text-accent';
      case 'opened':
        return 'bg-green-500/20 text-green-400';
      case 'failed':
        return 'bg-destructive/20 text-destructive';
    }
  };
  
  const deliveryRate = stats.total > 0 ? Math.round((stats.delivered / Math.max(stats.sent, 1)) * 100) : 0;
  const openRate = stats.delivered > 0 ? Math.round((stats.opened / stats.delivered) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`relative ${isLive ? 'animate-pulse' : ''}`}>
            <Radio className={`w-5 h-5 ${isLive ? 'text-green-400' : 'text-muted-foreground'}`} />
            {isLive && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full animate-ping" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Live Delivery Monitor</h3>
            <p className="text-sm text-muted-foreground">
              Real-time notification pipeline status
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="live-toggle" className="text-sm text-muted-foreground">
              Live Updates
            </Label>
            <Switch
              id="live-toggle"
              checked={isLive}
              onCheckedChange={setIsLive}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEvents([]);
              setStats({ sending: 0, sent: 0, delivered: 0, opened: 0, failed: 0, total: 0 });
              eventIdCounter.current = 0;
            }}
            className="gap-1"
          >
            <RefreshCw className="w-4 h-4" />
            Reset
          </Button>
        </div>
      </div>

      {/* Live Stats Bar */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-medium text-foreground">Throughput</span>
          </div>
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
            {throughput}/min
          </Badge>
        </div>
        
        {/* Pipeline Visualization */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {[
            { label: 'Sending', value: stats.sending, color: 'bg-muted-foreground', textColor: 'text-muted-foreground' },
            { label: 'Sent', value: stats.sent, color: 'bg-primary', textColor: 'text-primary' },
            { label: 'Delivered', value: stats.delivered, color: 'bg-accent', textColor: 'text-accent' },
            { label: 'Opened', value: stats.opened, color: 'bg-green-500', textColor: 'text-green-400' },
            { label: 'Failed', value: stats.failed, color: 'bg-destructive', textColor: 'text-destructive' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="text-center"
            >
              <div className={`text-2xl font-bold ${stat.textColor}`}>
                {stat.value.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className={`h-1 ${stat.color} rounded-full mt-2 opacity-60`} />
            </motion.div>
          ))}
        </div>
        
        {/* Progress Bars */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Delivery Rate</span>
              <span className="text-accent font-medium">{deliveryRate}%</span>
            </div>
            <Progress value={deliveryRate} className="h-2" />
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Open Rate</span>
              <span className="text-green-400 font-medium">{openRate}%</span>
            </div>
            <Progress value={openRate} className="h-2" />
          </div>
        </div>
      </div>

      {/* Live Feed */}
      <Card className="bg-card border-border overflow-hidden">
        <CardHeader className="pb-2 border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground'}`} />
              Live Event Feed
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {events.length} events
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[400px] overflow-y-auto">
            <AnimatePresence mode="popLayout">
              {events.map((event) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -20, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: 'auto' }}
                  exit={{ opacity: 0, x: 20, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="border-b border-border/50 last:border-0"
                >
                  <div className="px-4 py-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors">
                    {/* Status Icon */}
                    <div className={`p-1.5 rounded-lg ${getStatusColor(event.status)}`}>
                      {getStatusIcon(event.status)}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-foreground truncate">
                          {event.userName}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                          {getDeviceIcon(event.device)}
                          {event.device}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {event.title}
                      </p>
                    </div>
                    
                    {/* Campaign & Time */}
                    <div className="text-right shrink-0">
                      <Badge variant="outline" className="text-[10px] mb-1">
                        {event.campaignName}
                      </Badge>
                      <p className="text-[10px] text-muted-foreground">
                        {event.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                    
                    {/* Status Badge */}
                    <Badge className={`shrink-0 text-[10px] ${getStatusColor(event.status)}`}>
                      {event.status}
                    </Badge>
                  </div>
                </motion.div>
              ))}
              
              {events.length === 0 && (
                <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
                  <Radio className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">No events yet</p>
                  <p className="text-xs">Enable live updates to see notifications flow</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </CardContent>
      </Card>

      {/* Pipeline Visualization */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Notification Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            {[
              { label: 'Queue', icon: Send, count: stats.sending, color: 'text-muted-foreground' },
              { label: 'Sent', icon: CheckCircle, count: stats.sent, color: 'text-primary' },
              { label: 'Delivered', icon: CheckCircle, count: stats.delivered, color: 'text-accent' },
              { label: 'Opened', icon: Eye, count: stats.opened, color: 'text-green-400' },
            ].map((stage, i, arr) => (
              <div key={stage.label} className="flex items-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex flex-col items-center"
                >
                  <div className={`p-3 rounded-xl bg-secondary/50 border border-border ${stage.color}`}>
                    <stage.icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-muted-foreground mt-2">{stage.label}</span>
                  <span className={`text-lg font-bold ${stage.color}`}>
                    {stage.count.toLocaleString()}
                  </span>
                </motion.div>
                
                {i < arr.length - 1 && (
                  <div className="flex-1 mx-4 relative">
                    <div className="h-0.5 bg-border w-full" />
                    {isLive && (
                      <motion.div
                        className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary"
                        animate={{ x: [0, 60, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default NotificationDeliveryMonitor;
