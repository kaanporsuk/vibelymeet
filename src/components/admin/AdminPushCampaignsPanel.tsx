import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  Send,
  Users,
  Plus,
  Trash2,
  Edit,
  Clock,
  CheckCircle,
  XCircle,
  Target,
  Activity,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  BarChart3,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import AdminConfirmDialog from "./AdminConfirmDialog";

interface Campaign {
  id: string;
  title: string;
  body: string;
  status: 'draft' | 'scheduled' | 'sent' | 'paused';
  targetSegment: TargetSegment;
  scheduledAt?: string;
  sentAt?: string;
  createdAt: string;
}

interface TargetSegment {
  // Legacy-only keys are kept so stored target_segment values can be flagged, not edited or applied.
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

type CampaignStats = {
  total: number;
  queued: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
};

type PushEventRow = {
  campaign_id: string | null;
  status: string | null;
};

const DEFAULT_TARGET_SEGMENT: TargetSegment = {
  gender: [],
  ageRange: [18, 50],
  isVerified: undefined,
};

const UNSUPPORTED_TARGETING_LABELS: Record<string, string> = {
  activityLevel: "activity",
  inactiveDays: "inactive days",
  hasMatches: "match count",
  locations: "locations",
  vibes: "vibes",
  dropResponseStatus: "drop response",
};

function parseTargetSegment(raw: string | null): TargetSegment {
  if (!raw || raw === "all") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as TargetSegment : {};
  } catch {
    return {};
  }
}

function normalizeSupportedSegment(segment: TargetSegment): TargetSegment {
  return {
    gender: Array.isArray(segment.gender) ? segment.gender : [],
    ageRange: Array.isArray(segment.ageRange) && segment.ageRange.length === 2
      ? [segment.ageRange[0], segment.ageRange[1]]
      : [18, 50],
    isVerified: segment.isVerified === true ? true : undefined,
  };
}

function unsupportedTargetingLabels(segment: TargetSegment): string[] {
  const labels: string[] = [];
  if ("activityLevel" in segment) labels.push(UNSUPPORTED_TARGETING_LABELS.activityLevel);
  if ("inactiveDays" in segment) labels.push(UNSUPPORTED_TARGETING_LABELS.inactiveDays);
  if ("hasMatches" in segment) labels.push(UNSUPPORTED_TARGETING_LABELS.hasMatches);
  if ("locations" in segment) labels.push(UNSUPPORTED_TARGETING_LABELS.locations);
  if ("vibes" in segment) labels.push(UNSUPPORTED_TARGETING_LABELS.vibes);
  if ("dropResponseStatus" in segment) labels.push(UNSUPPORTED_TARGETING_LABELS.dropResponseStatus);
  return labels;
}

const AdminPushCampaignsPanel = () => {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);
  const [isDeletingCampaign, setIsDeletingCampaign] = useState(false);
  
  // Fetch campaigns from database
  const { data: campaigns = [] } = useQuery({
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
        title: c.title,
        body: c.body,
        status: c.status as Campaign['status'],
        targetSegment: parseTargetSegment(c.target_segment),
        scheduledAt: c.scheduled_at || undefined,
        sentAt: c.sent_at || undefined,
        createdAt: c.created_at,
      }));
    },
  });

  const { data: pushEventRows = [] } = useQuery({
    queryKey: ['push-campaign-event-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('push_notification_events_admin')
        .select('campaign_id, status');
      if (error) throw error;
      return (data || []) as PushEventRow[];
    },
  });
  
  // Create form state
  const [formData, setFormData] = useState({
    title: '',
    body: '',
  });
  
  const [segment, setSegment] = useState<TargetSegment>(DEFAULT_TARGET_SEGMENT);

  // Load editing campaign data into form
  useEffect(() => {
    if (editingCampaign) {
      setFormData({
        title: editingCampaign.title,
        body: editingCampaign.body,
      });
      setSegment(normalizeSupportedSegment(editingCampaign.targetSegment || DEFAULT_TARGET_SEGMENT));
      setShowCreateForm(true);
    }
  }, [editingCampaign]);

  const [expandedSections, setExpandedSections] = useState({
    demographics: true,
    engagement: true,
  });

  // Get estimated reach
  const { data: estimatedReach = 0 } = useQuery({
    queryKey: ['campaign-reach', segment],
    queryFn: async () => {
      // Keep the reach preview aligned with the only targeting filters currently applied.
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

  const campaignStats = useMemo(() => {
    const statsByCampaign = new Map<string, CampaignStats>();
    const emptyStats = (): CampaignStats => ({
      total: 0,
      queued: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      failed: 0,
    });

    for (const row of pushEventRows) {
      if (!row.campaign_id) continue;
      const stats = statsByCampaign.get(row.campaign_id) ?? emptyStats();
      stats.total += 1;
      switch (row.status) {
        case "queued":
          stats.queued += 1;
          break;
        case "sent":
          stats.sent += 1;
          break;
        case "delivered":
          stats.sent += 1;
          stats.delivered += 1;
          break;
        case "opened":
          stats.sent += 1;
          stats.delivered += 1;
          stats.opened += 1;
          break;
        case "clicked":
          stats.sent += 1;
          stats.delivered += 1;
          stats.opened += 1;
          stats.clicked += 1;
          break;
        case "failed":
        case "bounced":
          stats.failed += 1;
          break;
      }
      statsByCampaign.set(row.campaign_id, stats);
    }

    return statsByCampaign;
  }, [pushEventRows]);

  const aggregateStats = useMemo(() => {
    const totals: CampaignStats = {
      total: 0,
      queued: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      failed: 0,
    };
    for (const stats of campaignStats.values()) {
      totals.total += stats.total;
      totals.queued += stats.queued;
      totals.sent += stats.sent;
      totals.delivered += stats.delivered;
      totals.opened += stats.opened;
      totals.clicked += stats.clicked;
      totals.failed += stats.failed;
    }
    return totals;
  }, [campaignStats]);

  const resetCampaignForm = () => {
    setShowCreateForm(false);
    setEditingCampaign(null);
    setFormData({ title: '', body: '' });
    setSegment(DEFAULT_TARGET_SEGMENT);
  };

  const handleSaveCampaign = async () => {
    if (!formData.title || !formData.body) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const isEditing = !!editingCampaign;
      const supportedSegment = normalizeSupportedSegment(segment);
      
      const campaignData = {
        title: formData.title,
        body: formData.body,
        target_segment: JSON.stringify(supportedSegment),
      };

      if (isEditing) {
        // Update existing campaign
        const { error } = await supabase
          .from('push_campaigns')
          .update(campaignData)
          .eq('id', editingCampaign.id);
        
        if (error) throw error;
        toast.success('Campaign updated successfully.');
      } else {
        // Create new campaign
        const { error } = await supabase
          .from('push_campaigns')
          .insert({
            ...campaignData,
            status: 'draft',
            scheduled_at: null,
            sent_at: null,
            created_by: user.id,
          });
        
        if (error) throw error;
        toast.success('Campaign draft saved. Delivery is disabled until the backend dispatcher is implemented.');
      }

      // Refresh campaigns list
      queryClient.invalidateQueries({ queryKey: ['push-campaigns'] });
      resetCampaignForm();
    } catch (error) {
      console.error('Campaign error:', error);
      toast.error('Failed to save campaign');
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    setIsDeletingCampaign(true);
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
      throw error;
    } finally {
      setIsDeletingCampaign(false);
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
    icon: LucideIcon;
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
      title: template.title,
      body: template.body,
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
            Draft campaign copy and supported targeting. Delivery is disabled until a backend dispatcher exists.
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
                  <span className="text-xs">Notification Events</span>
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {aggregateStats.total.toLocaleString()}
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
                  {aggregateStats.delivered.toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-xs">Open Rate</span>
                </div>
                <p className="text-2xl font-bold text-primary">
                  {aggregateStats.delivered > 0
                    ? `${Math.round((aggregateStats.opened / aggregateStats.delivered) * 100)}%`
                    : "—"}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Clock className="w-4 h-4" />
                  <span className="text-xs">Drafts</span>
                </div>
                <p className="text-2xl font-bold text-muted-foreground">
                  {campaigns.filter(c => c.status === 'draft').length}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Campaign List */}
          <div className="space-y-4">
            {campaigns.map((campaign) => {
              const unsupportedLabels = unsupportedTargetingLabels(campaign.targetSegment);
              const stats = campaignStats.get(campaign.id);
              const openRate = stats && stats.delivered > 0
                ? `${Math.round((stats.opened / stats.delivered) * 100)}%`
                : "—";
              const supportedSegment = normalizeSupportedSegment(campaign.targetSegment);

              return (
                <motion.div
                  key={campaign.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-card rounded-2xl p-4 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground">{campaign.title}</h3>
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
                        {unsupportedLabels.length > 0 && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 text-amber-500"
                            title={`Stored but not applied: ${unsupportedLabels.join(", ")}`}
                          >
                            Unsupported targeting stored
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{campaign.body}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setEditingCampaign(campaign)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setCampaignToDelete(campaign)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {supportedSegment.gender?.length ? (
                      <Badge variant="outline" className="gap-1">
                        <Users className="w-3 h-3" />
                        {supportedSegment.gender.join(", ")}
                      </Badge>
                    ) : null}
                    {supportedSegment.isVerified && (
                      <Badge variant="outline" className="gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Verified only
                      </Badge>
                    )}
                    {supportedSegment.ageRange && (supportedSegment.ageRange[0] !== 18 || supportedSegment.ageRange[1] !== 50) && (
                      <Badge variant="outline" className="gap-1">
                        <Target className="w-3 h-3" />
                        Ages {supportedSegment.ageRange[0]}-{supportedSegment.ageRange[1]}
                      </Badge>
                    )}
                  </div>

                  {stats && stats.total > 0 && (
                    <div className="flex flex-wrap gap-4 pt-2 border-t border-border/50 text-sm">
                      <div>
                        <span className="text-muted-foreground">Queued:</span>{' '}
                        <span className="font-medium text-foreground">{stats.queued.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Sent:</span>{' '}
                        <span className="font-medium text-foreground">{stats.sent.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Delivered:</span>{' '}
                        <span className="font-medium text-accent">{stats.delivered.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Opened:</span>{' '}
                        <span className="font-medium text-primary">{stats.opened.toLocaleString()} ({openRate})</span>
                      </div>
                    </div>
                  )}

                  {campaign.scheduledAt && (
                    <div className="text-xs text-amber-500">
                      <Clock className="w-3 h-3 inline mr-1" />
                      Legacy scheduled timestamp stored for {format(new Date(campaign.scheduledAt), 'MMM d, yyyy h:mm a')}; no dispatcher was found in this frontend-only pass.
                    </div>
                  )}
                </motion.div>
              );
            })}
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
                    New campaigns save as drafts. Sending and scheduling require a backend dispatcher.
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={resetCampaignForm}>
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
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600">
                      Delivery is disabled in this frontend-only pass. Campaigns are saved as drafts and do not queue push notification events.
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
                      Estimated reach: <span className="text-foreground font-medium">{estimatedReach.toLocaleString()} users</span>.
                      This preview uses gender, verified status, and age only.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
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
                  Draft reach preview: <span className="text-foreground font-medium">{estimatedReach.toLocaleString()}</span> users
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={resetCampaignForm}>
                    Cancel
                  </Button>
                  <Button onClick={handleSaveCampaign} className="gap-2">
                    <FileText className="w-4 h-4" />
                    {editingCampaign ? 'Update Campaign' : 'Save Draft'}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AdminConfirmDialog
        open={!!campaignToDelete}
        title="Delete push campaign?"
        description={`This permanently deletes the campaign row "${campaignToDelete?.title || "selected campaign"}". If delivery event rows exist, the database cascade can also delete that campaign's notification analytics history. Delivered pushes cannot be recalled.`}
        confirmLabel="Delete Campaign"
        isPending={isDeletingCampaign}
        onOpenChange={(open) => {
          if (!open) setCampaignToDelete(null);
        }}
        onConfirm={() => {
          if (campaignToDelete) return handleDeleteCampaign(campaignToDelete.id);
        }}
      />
    </motion.div>
  );
};

export default AdminPushCampaignsPanel;
