import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Send,
  Users,
  Filter,
  Plus,
  Trash2,
  Edit,
  Play,
  Pause,
  Clock,
  CheckCircle,
  XCircle,
  Target,
  MapPin,
  Sparkles,
  Calendar,
  Activity,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  BarChart3,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import PushAnalyticsDashboard from "./PushAnalyticsDashboard";
import CampaignTemplatesLibrary, { CampaignTemplate } from "./CampaignTemplatesLibrary";
import LiveNotificationMonitor from "./LiveNotificationMonitor";

interface Campaign {
  id: string;
  name: string;
  title: string;
  body: string;
  status: 'draft' | 'scheduled' | 'sent' | 'paused';
  targetSegment: TargetSegment;
  scheduledAt?: string;
  sentAt?: string;
  createdAt: string;
  stats?: {
    sent: number;
    delivered: number;
    opened: number;
  };
}

interface TargetSegment {
  activityLevel?: 'all' | 'active' | 'inactive' | 'dormant';
  inactiveDays?: number;
  gender?: string[];
  ageRange?: [number, number];
  hasMatches?: boolean;
  isVerified?: boolean;
  locations?: string[];
  vibes?: string[];
  dropResponseStatus?: 'all' | 'responded' | 'unresponded';
}

const AdminPushCampaignsPanel = () => {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  
  // Fetch campaigns from database
  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery({
    queryKey: ['push-campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('push_campaigns')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      // Transform to our Campaign interface
      return (data || []).map(c => ({
        id: c.id,
        name: c.title,
        title: c.title,
        body: c.body,
        status: c.status as Campaign['status'],
        targetSegment: (c.target_segment ? JSON.parse(c.target_segment as string) : {}) as TargetSegment,
        scheduledAt: c.scheduled_at || undefined,
        sentAt: c.sent_at || undefined,
        createdAt: c.created_at,
        stats: c.sent_at ? { sent: 0, delivered: 0, opened: 0 } : undefined,
      }));
    },
  });
  
  // Create form state
  const [formData, setFormData] = useState({
    name: '',
    title: '',
    body: '',
    scheduleType: 'now' as 'now' | 'scheduled',
    scheduledAt: '',
  });
  
  const [segment, setSegment] = useState<TargetSegment>({
    activityLevel: 'all',
    inactiveDays: 3,
    gender: [],
    ageRange: [18, 50],
    hasMatches: undefined,
    isVerified: undefined,
    locations: [],
    vibes: [],
    dropResponseStatus: 'all',
  });

  // Load editing campaign data into form
  useEffect(() => {
    if (editingCampaign) {
      setFormData({
        name: editingCampaign.name,
        title: editingCampaign.title,
        body: editingCampaign.body,
        scheduleType: editingCampaign.scheduledAt ? 'scheduled' : 'now',
        scheduledAt: editingCampaign.scheduledAt || '',
      });
      setSegment(editingCampaign.targetSegment || {
        activityLevel: 'all',
        inactiveDays: 3,
        gender: [],
        ageRange: [18, 50],
        hasMatches: undefined,
        isVerified: undefined,
        locations: [],
        vibes: [],
        dropResponseStatus: 'all',
      });
      setShowCreateForm(true);
    }
  }, [editingCampaign]);

  const [expandedSections, setExpandedSections] = useState({
    activity: true,
    demographics: false,
    engagement: false,
    vibes: false,
  });

  // Fetch vibe tags
  const { data: vibeTags = [] } = useQuery({
    queryKey: ['vibe-tags'],
    queryFn: async () => {
      const { data } = await supabase
        .from('vibe_tags')
        .select('*')
        .order('category');
      return data || [];
    },
  });

  // Get estimated reach
  const { data: estimatedReach = 0 } = useQuery({
    queryKey: ['campaign-reach', segment],
    queryFn: async () => {
      // In production, this would query the database with filters
      let query = supabase.from('profiles').select('id', { count: 'exact', head: true });
      
      if (segment.gender?.length) {
        query = query.in('gender', segment.gender);
      }
      if (segment.isVerified !== undefined) {
        query = query.eq('photo_verified', segment.isVerified);
      }
      if (segment.ageRange) {
        query = query.gte('age', segment.ageRange[0]).lte('age', segment.ageRange[1]);
      }
      
      const { count } = await query;
      return count || 0;
    },
    enabled: showCreateForm || !!editingCampaign,
  });

  const handleCreateCampaign = async () => {
    if (!formData.name || !formData.title || !formData.body) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const isEditing = !!editingCampaign;
      
      const campaignData = {
        title: formData.title,
        body: formData.body,
        target_segment: JSON.stringify(segment),
        status: formData.scheduleType === 'now' ? 'sent' : 'scheduled',
        scheduled_at: formData.scheduleType === 'scheduled' ? formData.scheduledAt : null,
        sent_at: formData.scheduleType === 'now' ? new Date().toISOString() : null,
        created_by: user.id,
      };

      if (isEditing) {
        // Update existing campaign
        const { error } = await supabase
          .from('push_campaigns')
          .update(campaignData)
          .eq('id', editingCampaign.id);
        
        if (error) throw error;
        toast.success('Campaign updated successfully!');
      } else {
        // Create new campaign
        const { data: newCampaign, error } = await supabase
          .from('push_campaigns')
          .insert(campaignData)
          .select()
          .single();
        
        if (error) throw error;
        
        // If sending now, also send the notifications to users
        if (formData.scheduleType === 'now' && newCampaign) {
          await sendNotificationsToUsers(newCampaign.id, formData.title, formData.body, segment);
        }
        
        toast.success(formData.scheduleType === 'now' ? 'Campaign sent successfully!' : 'Campaign scheduled successfully!');
      }

      // Refresh campaigns list
      queryClient.invalidateQueries({ queryKey: ['push-campaigns'] });
      
      setShowCreateForm(false);
      setEditingCampaign(null);
      setFormData({ name: '', title: '', body: '', scheduleType: 'now', scheduledAt: '' });
      setSegment({ activityLevel: 'all', inactiveDays: 3, gender: [], ageRange: [18, 50], hasMatches: undefined, isVerified: undefined, locations: [], vibes: [], dropResponseStatus: 'all' });
    } catch (error) {
      console.error('Campaign error:', error);
      toast.error('Failed to save campaign');
    }
  };

  // Send notifications to matching users
  const sendNotificationsToUsers = async (
    campaignId: string,
    title: string,
    body: string,
    segment: TargetSegment
  ) => {
    try {
      // Build query based on segment
      let query = supabase.from('profiles').select('id');
      
      if (segment.gender?.length) {
        query = query.in('gender', segment.gender);
      }
      if (segment.isVerified !== undefined) {
        query = query.eq('photo_verified', segment.isVerified);
      }
      if (segment.ageRange) {
        query = query.gte('age', segment.ageRange[0]).lte('age', segment.ageRange[1]);
      }
      
      const { data: users } = await query;
      
      if (!users?.length) return;
      
      // Create notification events for tracking
      const events = users.map(u => ({
        campaign_id: campaignId,
        user_id: u.id,
        platform: 'web' as const,
        status: 'queued' as const,
      }));
      
      // Insert events in batches
      const batchSize = 100;
      for (let i = 0; i < events.length; i += batchSize) {
        const batch = events.slice(i, i + batchSize);
        await supabase.from('push_notification_events').insert(batch);
      }
      
      console.log(`Queued ${users.length} notification events for campaign ${campaignId}`);
    } catch (error) {
      console.error('Error sending notifications:', error);
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    try {
      const { error } = await supabase
        .from('push_campaigns')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      queryClient.invalidateQueries({ queryKey: ['push-campaigns'] });
      toast.success('Campaign deleted');
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Failed to delete campaign');
    }
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const SegmentSection = ({ 
    title, 
    icon: Icon, 
    sectionKey,
    children 
  }: { 
    title: string; 
    icon: any; 
    sectionKey: keyof typeof expandedSections;
    children: React.ReactNode;
  }) => {
    const isOpen = expandedSections[sectionKey];
    
    return (
      <div className="rounded-xl border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection(sectionKey)}
          className="w-full flex items-center justify-between p-3 bg-secondary/30 hover:bg-secondary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{title}</span>
          </div>
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="p-4 space-y-4 bg-card">
                {children}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const handleSelectTemplate = (template: CampaignTemplate) => {
    setFormData({
      name: template.name,
      title: template.title,
      body: template.body,
      scheduleType: 'now',
      scheduledAt: '',
    });
    setShowCreateForm(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Push Campaigns</h2>
          <p className="text-sm text-muted-foreground">
            Send targeted notifications to user segments
          </p>
        </div>
        <Button
          onClick={() => setShowCreateForm(true)}
          className="bg-gradient-to-r from-primary to-accent gap-2"
        >
          <Plus className="w-5 h-5" />
          Create Campaign
        </Button>
      </div>

      {/* Tabs for different views */}
      <Tabs defaultValue="campaigns" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="campaigns" className="gap-2">
            <Send className="w-4 h-4" />
            Campaigns
          </TabsTrigger>
          <TabsTrigger value="monitor" className="gap-2">
            <Activity className="w-4 h-4" />
            Live Monitor
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-2">
            <FileText className="w-4 h-4" />
            Templates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="space-y-6">
          {/* Stats Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Send className="w-4 h-4" />
                  <span className="text-xs">Total Sent</span>
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {campaigns.reduce((sum, c) => sum + (c.stats?.sent || 0), 0).toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-xs">Delivered</span>
                </div>
                <p className="text-2xl font-bold text-accent">
                  {campaigns.reduce((sum, c) => sum + (c.stats?.delivered || 0), 0).toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-xs">Avg Open Rate</span>
                </div>
                <p className="text-2xl font-bold text-primary">35.8%</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Clock className="w-4 h-4" />
                  <span className="text-xs">Scheduled</span>
                </div>
                <p className="text-2xl font-bold text-muted-foreground">
                  {campaigns.filter(c => c.status === 'scheduled').length}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Campaign List */}
          <div className="space-y-4">
            {campaigns.map((campaign) => (
              <motion.div
                key={campaign.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground">{campaign.name}</h3>
                      <Badge
                        className={
                          campaign.status === 'sent'
                            ? 'bg-green-500/10 text-green-400 border-green-500/30'
                            : campaign.status === 'scheduled'
                            ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
                            : campaign.status === 'paused'
                            ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                            : 'bg-gray-500/10 text-gray-400 border-gray-500/30'
                        }
                      >
                        {campaign.status}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium text-foreground">{campaign.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{campaign.body}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {campaign.status === 'scheduled' && (
                      <Button variant="ghost" size="icon" onClick={() => toast.success('Campaign paused')}>
                        <Pause className="w-4 h-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setEditingCampaign(campaign)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteCampaign(campaign.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {campaign.targetSegment.activityLevel && campaign.targetSegment.activityLevel !== 'all' && (
                    <Badge variant="outline" className="gap-1">
                      <Activity className="w-3 h-3" />
                      {campaign.targetSegment.activityLevel}
                      {campaign.targetSegment.inactiveDays && ` (${campaign.targetSegment.inactiveDays}+ days)`}
                    </Badge>
                  )}
                  {campaign.targetSegment.isVerified && (
                    <Badge variant="outline" className="gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Verified only
                    </Badge>
                  )}
                  {campaign.targetSegment.vibes?.length ? (
                    <Badge variant="outline" className="gap-1">
                      <Sparkles className="w-3 h-3" />
                      {campaign.targetSegment.vibes.join(', ')}
                    </Badge>
                  ) : null}
                </div>

                {campaign.stats && (
                  <div className="flex gap-4 pt-2 border-t border-border/50 text-sm">
                    <div>
                      <span className="text-muted-foreground">Sent:</span>{' '}
                      <span className="font-medium text-foreground">{campaign.stats.sent.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Delivered:</span>{' '}
                      <span className="font-medium text-accent">{campaign.stats.delivered.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Opened:</span>{' '}
                      <span className="font-medium text-primary">
                        {campaign.stats.opened.toLocaleString()} ({Math.round((campaign.stats.opened / campaign.stats.delivered) * 100)}%)
                      </span>
                    </div>
                  </div>
                )}

                {campaign.scheduledAt && (
                  <div className="text-xs text-muted-foreground">
                    <Clock className="w-3 h-3 inline mr-1" />
                    Scheduled for {format(new Date(campaign.scheduledAt), 'MMM d, yyyy h:mm a')}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="monitor">
          <LiveNotificationMonitor />
        </TabsContent>

        <TabsContent value="analytics">
          <PushAnalyticsDashboard />
        </TabsContent>

        <TabsContent value="templates">
          <CampaignTemplatesLibrary onSelectTemplate={handleSelectTemplate} />
        </TabsContent>
      </Tabs>

      {/* Create Campaign Modal */}
      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background z-50 flex flex-col"
          >
            {/* Header */}
            <div className="shrink-0 border-b border-border bg-card">
              <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold font-display text-foreground">
                    {editingCampaign ? 'Edit Push Campaign' : 'Create Push Campaign'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Target specific user segments with personalized notifications
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => {
                  setShowCreateForm(false);
                  setEditingCampaign(null);
                  setFormData({ name: '', title: '', body: '', scheduleType: 'now', scheduledAt: '' });
                  setSegment({ activityLevel: 'all', inactiveDays: 3, gender: [], ageRange: [18, 50], hasMatches: undefined, isVerified: undefined, locations: [], vibes: [], dropResponseStatus: 'all' });
                }}>
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
            </div>

            {/* Form Content */}
            <div className="flex-1 overflow-auto">
              <div className="max-w-4xl mx-auto p-4 space-y-6 pb-32">
                {/* Campaign Details */}
                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Bell className="w-5 h-5 text-primary" />
                      Campaign Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Campaign Name</Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g., Re-engagement - 3 Day Inactive"
                        className="bg-secondary/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Notification Title</Label>
                      <Input
                        value={formData.title}
                        onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="e.g., Your daily vibe is waiting! 💫"
                        className="bg-secondary/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Notification Body</Label>
                      <Textarea
                        value={formData.body}
                        onChange={(e) => setFormData(prev => ({ ...prev, body: e.target.value }))}
                        placeholder="e.g., You haven't checked your daily drop in a while..."
                        className="bg-secondary/50 min-h-[80px]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Schedule</Label>
                        <Select
                          value={formData.scheduleType}
                          onValueChange={(v: 'now' | 'scheduled') => setFormData(prev => ({ ...prev, scheduleType: v }))}
                        >
                          <SelectTrigger className="bg-secondary/50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="now">Send Now</SelectItem>
                            <SelectItem value="scheduled">Schedule</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {formData.scheduleType === 'scheduled' && (
                        <div className="space-y-2">
                          <Label>Send At</Label>
                          <Input
                            type="datetime-local"
                            value={formData.scheduledAt}
                            onChange={(e) => setFormData(prev => ({ ...prev, scheduledAt: e.target.value }))}
                            className="bg-secondary/50"
                          />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Target Audience */}
                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="w-5 h-5 text-primary" />
                      Target Audience
                    </CardTitle>
                    <CardDescription>
                      Estimated reach: <span className="text-foreground font-medium">{estimatedReach.toLocaleString()} users</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Activity Level */}
                    <SegmentSection title="Activity Level" icon={Activity} sectionKey="activity">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>User Activity</Label>
                          <Select
                            value={segment.activityLevel}
                            onValueChange={(v: any) => setSegment(prev => ({ ...prev, activityLevel: v }))}
                          >
                            <SelectTrigger className="bg-secondary/50">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Users</SelectItem>
                              <SelectItem value="active">Active (last 7 days)</SelectItem>
                              <SelectItem value="inactive">Inactive (3+ days)</SelectItem>
                              <SelectItem value="dormant">Dormant (30+ days)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {segment.activityLevel === 'inactive' && (
                          <div className="space-y-2">
                            <Label>Inactive for at least (days)</Label>
                            <div className="flex items-center gap-4">
                              <Slider
                                value={[segment.inactiveDays || 3]}
                                onValueChange={([v]) => setSegment(prev => ({ ...prev, inactiveDays: v }))}
                                min={1}
                                max={30}
                                step={1}
                                className="flex-1"
                              />
                              <span className="text-foreground font-medium w-8">{segment.inactiveDays}</span>
                            </div>
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label>Daily Drop Response</Label>
                          <Select
                            value={segment.dropResponseStatus}
                            onValueChange={(v: any) => setSegment(prev => ({ ...prev, dropResponseStatus: v }))}
                          >
                            <SelectTrigger className="bg-secondary/50">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              <SelectItem value="responded">Responded to drops</SelectItem>
                              <SelectItem value="unresponded">Haven't responded (3+ days)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </SegmentSection>

                    {/* Demographics */}
                    <SegmentSection title="Demographics" icon={Users} sectionKey="demographics">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Gender</Label>
                          <div className="flex gap-2">
                            {['Male', 'Female', 'Non-binary'].map((g) => (
                              <Button
                                key={g}
                                type="button"
                                size="sm"
                                variant={segment.gender?.includes(g) ? 'default' : 'outline'}
                                onClick={() => setSegment(prev => ({
                                  ...prev,
                                  gender: prev.gender?.includes(g)
                                    ? prev.gender.filter(x => x !== g)
                                    : [...(prev.gender || []), g]
                                }))}
                              >
                                {g}
                              </Button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Age Range: {segment.ageRange?.[0]} - {segment.ageRange?.[1]}</Label>
                          <Slider
                            value={segment.ageRange}
                            onValueChange={(v) => setSegment(prev => ({ ...prev, ageRange: v as [number, number] }))}
                            min={18}
                            max={65}
                            step={1}
                          />
                        </div>
                      </div>
                    </SegmentSection>

                    {/* Engagement */}
                    <SegmentSection title="Engagement" icon={TrendingUp} sectionKey="engagement">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <Label>Verified Users Only</Label>
                          <Switch
                            checked={segment.isVerified === true}
                            onCheckedChange={(checked) => setSegment(prev => ({ ...prev, isVerified: checked ? true : undefined }))}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label>Has Matches</Label>
                          <Switch
                            checked={segment.hasMatches === true}
                            onCheckedChange={(checked) => setSegment(prev => ({ ...prev, hasMatches: checked ? true : undefined }))}
                          />
                        </div>
                      </div>
                    </SegmentSection>

                    {/* Vibes */}
                    <SegmentSection title="Vibes & Interests" icon={Sparkles} sectionKey="vibes">
                      <div className="flex flex-wrap gap-2">
                        {vibeTags.map((tag: any) => (
                          <Button
                            key={tag.id}
                            type="button"
                            size="sm"
                            variant={segment.vibes?.includes(tag.label) ? 'default' : 'outline'}
                            onClick={() => setSegment(prev => ({
                              ...prev,
                              vibes: prev.vibes?.includes(tag.label)
                                ? prev.vibes.filter(v => v !== tag.label)
                                : [...(prev.vibes || []), tag.label]
                            }))}
                            className="gap-1"
                          >
                            {tag.emoji} {tag.label}
                          </Button>
                        ))}
                      </div>
                    </SegmentSection>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-border bg-card">
              <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
                <div className="text-sm text-muted-foreground">
                  <Target className="w-4 h-4 inline mr-1" />
                  Targeting <span className="text-foreground font-medium">{estimatedReach.toLocaleString()}</span> users
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => {
                    setShowCreateForm(false);
                    setEditingCampaign(null);
                    setFormData({ name: '', title: '', body: '', scheduleType: 'now', scheduledAt: '' });
                    setSegment({ activityLevel: 'all', inactiveDays: 3, gender: [], ageRange: [18, 50], hasMatches: undefined, isVerified: undefined, locations: [], vibes: [], dropResponseStatus: 'all' });
                  }}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateCampaign} className="gap-2">
                    <Send className="w-4 h-4" />
                    {editingCampaign ? 'Update Campaign' : (formData.scheduleType === 'now' ? 'Send Now' : 'Schedule')}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default AdminPushCampaignsPanel;
