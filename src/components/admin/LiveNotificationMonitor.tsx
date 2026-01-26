import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  CheckCircle,
  Eye,
  AlertCircle,
  Zap,
  Radio,
  RefreshCw,
  Smartphone,
  Monitor,
  MousePointerClick,
  Clock,
  Tablet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePushNotificationEvents, NotificationPlatform, NotificationStatus } from "@/hooks/usePushNotificationEvents";

const LiveNotificationMonitor = () => {
  const { 
    events, 
    stats, 
    isLoading, 
    isLive, 
    setIsLive, 
    refetch, 
    resetEvents 
  } = usePushNotificationEvents(100);
  
  const [activeTab, setActiveTab] = useState("all");

  const getStatusIcon = (status: NotificationStatus) => {
    switch (status) {
      case "queued":
        return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
      case "sending":
        return <Send className="w-3.5 h-3.5 text-muted-foreground animate-pulse" />;
      case "sent":
        return <CheckCircle className="w-3.5 h-3.5 text-primary" />;
      case "delivered":
        return <CheckCircle className="w-3.5 h-3.5 text-accent" />;
      case "opened":
        return <Eye className="w-3.5 h-3.5 text-green-400" />;
      case "clicked":
        return <MousePointerClick className="w-3.5 h-3.5 text-blue-400" />;
      case "failed":
      case "bounced":
        return <AlertCircle className="w-3.5 h-3.5 text-destructive" />;
    }
  };

  const getDeviceIcon = (platform: NotificationPlatform) => {
    switch (platform) {
      case "ios":
        return <Smartphone className="w-3 h-3" />;
      case "android":
        return <Smartphone className="w-3 h-3" />;
      case "pwa":
        return <Tablet className="w-3 h-3" />;
      case "web":
        return <Monitor className="w-3 h-3" />;
    }
  };

  const getStatusColor = (status: NotificationStatus) => {
    switch (status) {
      case "queued":
        return "bg-muted-foreground/20 text-muted-foreground";
      case "sending":
        return "bg-muted-foreground/20 text-muted-foreground";
      case "sent":
        return "bg-primary/20 text-primary";
      case "delivered":
        return "bg-accent/20 text-accent";
      case "opened":
        return "bg-green-500/20 text-green-400";
      case "clicked":
        return "bg-blue-500/20 text-blue-400";
      case "failed":
      case "bounced":
        return "bg-destructive/20 text-destructive";
    }
  };

  const getPlatformLabel = (platform: NotificationPlatform) => {
    switch (platform) {
      case "ios": return "iOS";
      case "android": return "Android";
      case "pwa": return "PWA";
      case "web": return "Web";
    }
  };

  const deliveryRate = stats.sent > 0 ? Math.round((stats.delivered / stats.sent) * 100) : 0;
  const openRate = stats.delivered > 0 ? Math.round((stats.opened / stats.delivered) * 100) : 0;
  const clickRate = stats.opened > 0 ? Math.round((stats.clicked / stats.opened) * 100) : 0;

  const filteredEvents = activeTab === "all" 
    ? events 
    : events.filter(e => e.platform === activeTab);

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`relative ${isLive ? "animate-pulse" : ""}`}>
            <Radio className={`w-5 h-5 ${isLive ? "text-green-400" : "text-muted-foreground"}`} />
            {isLive && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full animate-ping" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Live Delivery Monitor</h3>
            <p className="text-sm text-muted-foreground">
              Real-time notification pipeline with FCM/APNs webhooks
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
              resetEvents();
              refetch();
            }}
            className="gap-1"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Live Stats Bar */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-medium text-foreground">Real-time Stats</span>
          </div>
          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
            {stats.total} events tracked
          </Badge>
        </div>

        {/* Pipeline Visualization */}
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-4">
          {[
            { label: "Queued", value: stats.queued, color: "bg-muted-foreground", textColor: "text-muted-foreground" },
            { label: "Sending", value: stats.sending, color: "bg-muted-foreground", textColor: "text-muted-foreground" },
            { label: "Sent", value: stats.sent, color: "bg-primary", textColor: "text-primary" },
            { label: "Delivered", value: stats.delivered, color: "bg-accent", textColor: "text-accent" },
            { label: "Opened", value: stats.opened, color: "bg-green-500", textColor: "text-green-400" },
            { label: "Clicked", value: stats.clicked, color: "bg-blue-500", textColor: "text-blue-400" },
            { label: "Failed", value: stats.failed, color: "bg-destructive", textColor: "text-destructive" },
            { label: "Bounced", value: stats.bounced, color: "bg-orange-500", textColor: "text-orange-400" },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="text-center"
            >
              <div className={`text-xl font-bold ${stat.textColor}`}>
                {stat.value.toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground">{stat.label}</div>
              <div className={`h-1 ${stat.color} rounded-full mt-1 opacity-60`} />
            </motion.div>
          ))}
        </div>

        {/* Progress Bars */}
        <div className="grid grid-cols-3 gap-4">
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
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Click-Through</span>
              <span className="text-blue-400 font-medium">{clickRate}%</span>
            </div>
            <Progress value={clickRate} className="h-2" />
          </div>
        </div>
      </div>

      {/* Platform Distribution */}
      <div className="grid grid-cols-4 gap-3">
        {(["web", "ios", "android", "pwa"] as NotificationPlatform[]).map((platform) => (
          <Card key={platform} className="bg-card border-border">
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                {getDeviceIcon(platform)}
                <span className="text-sm font-medium">{getPlatformLabel(platform)}</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stats.byPlatform[platform]}
              </div>
              <div className="text-xs text-muted-foreground">notifications</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Live Feed */}
      <Card className="bg-card border-border overflow-hidden">
        <CardHeader className="pb-2 border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isLive ? "bg-green-400 animate-pulse" : "bg-muted-foreground"}`} />
              Live Event Feed
            </CardTitle>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs px-2 h-6">All</TabsTrigger>
                <TabsTrigger value="web" className="text-xs px-2 h-6">Web</TabsTrigger>
                <TabsTrigger value="ios" className="text-xs px-2 h-6">iOS</TabsTrigger>
                <TabsTrigger value="android" className="text-xs px-2 h-6">Android</TabsTrigger>
                <TabsTrigger value="pwa" className="text-xs px-2 h-6">PWA</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[400px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {filteredEvents.map((event) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: -20, height: 0 }}
                    animate={{ opacity: 1, x: 0, height: "auto" }}
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
                            {event.user_name}
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                            {getDeviceIcon(event.platform)}
                            {getPlatformLabel(event.platform)}
                          </Badge>
                          {event.fcm_message_id && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-orange-500/10 text-orange-400 border-orange-500/30">
                              FCM
                            </Badge>
                          )}
                          {event.apns_message_id && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-400 border-blue-500/30">
                              APNs
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {event.campaign_title}
                        </p>
                        {event.error_message && (
                          <p className="text-xs text-destructive truncate">
                            Error: {event.error_message}
                          </p>
                        )}
                      </div>

                      {/* Time */}
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-muted-foreground">
                          {formatTimestamp(event.created_at)}
                        </p>
                      </div>

                      {/* Status Badge */}
                      <Badge className={`shrink-0 text-[10px] ${getStatusColor(event.status)}`}>
                        {event.status}
                      </Badge>
                    </div>
                  </motion.div>
                ))}

                {filteredEvents.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
                    <Radio className="w-8 h-8 mb-2 opacity-50" />
                    <p className="text-sm">No events yet</p>
                    <p className="text-xs">Webhook events will appear here in real-time</p>
                  </div>
                )}
              </AnimatePresence>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Pipeline Visualization */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Notification Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between overflow-x-auto pb-2">
            {[
              { label: "Queue", icon: Clock, count: stats.queued, color: "text-muted-foreground" },
              { label: "Sending", icon: Send, count: stats.sending, color: "text-muted-foreground" },
              { label: "Sent", icon: CheckCircle, count: stats.sent, color: "text-primary" },
              { label: "Delivered", icon: CheckCircle, count: stats.delivered, color: "text-accent" },
              { label: "Opened", icon: Eye, count: stats.opened, color: "text-green-400" },
              { label: "Clicked", icon: MousePointerClick, count: stats.clicked, color: "text-blue-400" },
            ].map((stage, i, arr) => (
              <div key={stage.label} className="flex items-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex flex-col items-center min-w-[60px]"
                >
                  <div className={`p-2 rounded-xl bg-secondary/50 border border-border ${stage.color}`}>
                    <stage.icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1">{stage.label}</span>
                  <span className={`text-sm font-bold ${stage.color}`}>
                    {stage.count.toLocaleString()}
                  </span>
                </motion.div>

                {i < arr.length - 1 && (
                  <div className="flex-1 mx-2 relative min-w-[20px]">
                    <div className="h-0.5 bg-border w-full" />
                    {isLive && (
                      <motion.div
                        className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary"
                        animate={{ x: [0, 20, 0] }}
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

      {/* Webhook Setup Info */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Webhook Endpoints</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 rounded-lg bg-secondary/30 border border-border">
            <p className="text-xs text-muted-foreground mb-1">Firebase Cloud Messaging (FCM)</p>
            <code className="text-xs text-foreground break-all">
              POST /functions/v1/push-webhook?provider=fcm
            </code>
          </div>
          <div className="p-3 rounded-lg bg-secondary/30 border border-border">
            <p className="text-xs text-muted-foreground mb-1">Apple Push Notification Service (APNs)</p>
            <code className="text-xs text-foreground break-all">
              POST /functions/v1/push-webhook?provider=apns
            </code>
          </div>
          <div className="p-3 rounded-lg bg-secondary/30 border border-border">
            <p className="text-xs text-muted-foreground mb-1">Web Push / Service Worker</p>
            <code className="text-xs text-foreground break-all">
              POST /functions/v1/push-webhook?provider=web
            </code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LiveNotificationMonitor;
