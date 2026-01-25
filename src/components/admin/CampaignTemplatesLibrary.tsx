import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  Heart,
  Calendar,
  Trophy,
  Sparkles,
  Users,
  Gift,
  Star,
  Zap,
  Bell,
  Edit,
  Copy,
  Check,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export interface CampaignTemplate {
  id: string;
  name: string;
  category: 'reengagement' | 'event' | 'milestone' | 'promotion';
  title: string;
  body: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  suggestedSegment?: string;
  variables?: string[];
}

const templates: CampaignTemplate[] = [
  // Re-engagement Templates
  {
    id: 're-1',
    name: 'Missed Daily Drop (3 days)',
    category: 'reengagement',
    title: 'Your daily vibe is waiting! 💫',
    body: "You haven't checked your daily drop in a while. Someone special might be waiting for you!",
    icon: <Clock className="w-5 h-5" />,
    color: 'from-orange-500 to-amber-500',
    description: 'For users who missed 3+ daily drops',
    suggestedSegment: 'Inactive 3+ days, hasn\'t responded to drops',
  },
  {
    id: 're-2',
    name: 'Week Away Welcome Back',
    category: 'reengagement',
    title: 'We miss you! 💕',
    body: "It's been a week since your last visit. Come see who's been checking out your profile!",
    icon: <Heart className="w-5 h-5" />,
    color: 'from-pink-500 to-rose-500',
    description: 'For users inactive for 7 days',
    suggestedSegment: 'Inactive 7+ days',
  },
  {
    id: 're-3',
    name: 'Dormant User Revival',
    category: 'reengagement',
    title: 'Your perfect match could be here ✨',
    body: "We've added new features and exciting profiles since you've been away. Ready to find your vibe?",
    icon: <Zap className="w-5 h-5" />,
    color: 'from-purple-500 to-violet-500',
    description: 'For users gone 14+ days',
    suggestedSegment: 'Inactive 14+ days',
  },
  {
    id: 're-4',
    name: 'Unread Messages Alert',
    category: 'reengagement',
    title: 'You have unread messages! 💬',
    body: "Don't leave {{count}} people hanging! Check your messages and keep the conversation flowing.",
    icon: <Bell className="w-5 h-5" />,
    color: 'from-cyan-500 to-teal-500',
    description: 'For users with pending messages',
    suggestedSegment: 'Has unread messages, inactive 2+ days',
    variables: ['count'],
  },
  
  // Event Promotion Templates
  {
    id: 'ev-1',
    name: 'New Event Announcement',
    category: 'event',
    title: 'New event alert! 🎉',
    body: 'Join "{{eventName}}" on {{eventDate}}. Limited spots available - register now!',
    icon: <Calendar className="w-5 h-5" />,
    color: 'from-blue-500 to-indigo-500',
    description: 'Announce a new event to relevant users',
    suggestedSegment: 'Based on event vibes & location',
    variables: ['eventName', 'eventDate'],
  },
  {
    id: 'ev-2',
    name: 'Event Reminder - Tomorrow',
    category: 'event',
    title: 'See you tomorrow! 📅',
    body: 'Just a reminder: "{{eventName}}" is tomorrow at {{eventTime}}. Get ready to meet amazing people!',
    icon: <Clock className="w-5 h-5" />,
    color: 'from-emerald-500 to-green-500',
    description: 'Remind registered attendees',
    suggestedSegment: 'Registered for event',
    variables: ['eventName', 'eventTime'],
  },
  {
    id: 'ev-3',
    name: 'Last Spots Available',
    category: 'event',
    title: 'Only {{spots}} spots left! 🔥',
    body: '"{{eventName}}" is almost full! Don\'t miss your chance to meet your future connections.',
    icon: <Zap className="w-5 h-5" />,
    color: 'from-red-500 to-orange-500',
    description: 'Create urgency for filling events',
    suggestedSegment: 'Interested but not registered',
    variables: ['spots', 'eventName'],
  },
  {
    id: 'ev-4',
    name: 'Post-Event Follow Up',
    category: 'event',
    title: 'Thanks for joining us! 💫',
    body: 'We hope you had a great time at "{{eventName}}"! Check your matches to continue the connections.',
    icon: <Star className="w-5 h-5" />,
    color: 'from-yellow-500 to-amber-500',
    description: 'Thank attendees after event',
    suggestedSegment: 'Attended event',
    variables: ['eventName'],
  },
  
  // Milestone Templates
  {
    id: 'mi-1',
    name: 'First Match Celebration',
    category: 'milestone',
    title: 'Congratulations on your first match! 🎊',
    body: "You've made your first connection! Send a message to {{matchName}} and start your conversation.",
    icon: <Trophy className="w-5 h-5" />,
    color: 'from-yellow-400 to-orange-500',
    description: 'Celebrate first match milestone',
    suggestedSegment: 'Just got first match',
    variables: ['matchName'],
  },
  {
    id: 'mi-2',
    name: 'Profile Verification Reminder',
    category: 'milestone',
    title: 'Get verified, get more matches! ✅',
    body: 'Verified profiles get 3x more matches. Complete your photo verification in just 30 seconds!',
    icon: <Check className="w-5 h-5" />,
    color: 'from-green-500 to-emerald-500',
    description: 'Encourage profile verification',
    suggestedSegment: 'Not verified, active users',
  },
  {
    id: 'mi-3',
    name: '10 Matches Milestone',
    category: 'milestone',
    title: "You're on fire! 🔥",
    body: "You've reached 10 matches! You're clearly making great impressions. Keep the momentum going!",
    icon: <Sparkles className="w-5 h-5" />,
    color: 'from-pink-500 to-purple-500',
    description: 'Celebrate 10 matches achievement',
    suggestedSegment: 'Just reached 10 matches',
  },
  {
    id: 'mi-4',
    name: 'Anniversary Celebration',
    category: 'milestone',
    title: 'Happy Vibely-versary! 🎂',
    body: "It's been {{duration}} since you joined Vibely! Thanks for being part of our community.",
    icon: <Gift className="w-5 h-5" />,
    color: 'from-violet-500 to-purple-500',
    description: 'Celebrate account anniversaries',
    suggestedSegment: '1 month/year anniversary',
    variables: ['duration'],
  },
  
  // Promotional Templates
  {
    id: 'pr-1',
    name: 'New Feature Announcement',
    category: 'promotion',
    title: 'New: Vibe Video is here! 🎬',
    body: 'Show your personality with our new video intro feature. Record your 30-second vibe and stand out!',
    icon: <Sparkles className="w-5 h-5" />,
    color: 'from-indigo-500 to-blue-500',
    description: 'Announce new app features',
    suggestedSegment: 'All active users',
  },
  {
    id: 'pr-2',
    name: 'Community Growth',
    category: 'promotion',
    title: '{{count}} new members this week! 🚀',
    body: 'Our community is growing fast. Log in to see fresh profiles and expand your connections!',
    icon: <Users className="w-5 h-5" />,
    color: 'from-teal-500 to-cyan-500',
    description: 'Highlight community growth',
    suggestedSegment: 'All users',
    variables: ['count'],
  },
];

interface CampaignTemplatesLibraryProps {
  onSelectTemplate: (template: CampaignTemplate) => void;
}

const CampaignTemplatesLibrary = ({ onSelectTemplate }: CampaignTemplatesLibraryProps) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [previewTemplate, setPreviewTemplate] = useState<CampaignTemplate | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedBody, setEditedBody] = useState('');
  
  const categories = [
    { id: 'all', label: 'All Templates', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'reengagement', label: 'Re-engagement', icon: <Clock className="w-4 h-4" /> },
    { id: 'event', label: 'Event Promotion', icon: <Calendar className="w-4 h-4" /> },
    { id: 'milestone', label: 'Milestones', icon: <Trophy className="w-4 h-4" /> },
    { id: 'promotion', label: 'Promotional', icon: <Gift className="w-4 h-4" /> },
  ];
  
  const filteredTemplates = selectedCategory === 'all' 
    ? templates 
    : templates.filter(t => t.category === selectedCategory);
  
  const handlePreview = (template: CampaignTemplate) => {
    setPreviewTemplate(template);
    setEditedTitle(template.title);
    setEditedBody(template.body);
  };
  
  const handleUseTemplate = () => {
    if (previewTemplate) {
      onSelectTemplate({
        ...previewTemplate,
        title: editedTitle,
        body: editedBody,
      });
      setPreviewTemplate(null);
      toast.success('Template applied! Customize your campaign.');
    }
  };
  
  const handleCopyTemplate = (template: CampaignTemplate) => {
    navigator.clipboard.writeText(`${template.title}\n\n${template.body}`);
    toast.success('Template copied to clipboard!');
  };
  
  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'reengagement': return 'bg-orange-500/10 text-orange-400 border-orange-500/30';
      case 'event': return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'milestone': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
      case 'promotion': return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      default: return 'bg-gray-500/10 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <div className="space-y-6">
      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <Button
            key={cat.id}
            variant={selectedCategory === cat.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategory(cat.id)}
            className="gap-1.5"
          >
            {cat.icon}
            {cat.label}
          </Button>
        ))}
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTemplates.map((template, index) => (
          <motion.div
            key={template.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card className="bg-card border-border h-full hover:border-primary/50 transition-colors group">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className={`p-2 rounded-lg bg-gradient-to-br ${template.color} text-white`}>
                    {template.icon}
                  </div>
                  <Badge variant="outline" className={getCategoryColor(template.category)}>
                    {template.category}
                  </Badge>
                </div>
                <CardTitle className="text-sm font-semibold mt-2">{template.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{template.description}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="p-3 rounded-lg bg-secondary/30 border border-border/50">
                  <p className="text-sm font-medium text-foreground line-clamp-1">{template.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{template.body}</p>
                </div>
                
                {template.suggestedSegment && (
                  <div className="text-xs text-muted-foreground">
                    <span className="text-foreground font-medium">Suggested:</span> {template.suggestedSegment}
                  </div>
                )}
                
                {template.variables && template.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {template.variables.map((v) => (
                      <Badge key={v} variant="outline" className="text-[10px] py-0">
                        {`{{${v}}}`}
                      </Badge>
                    ))}
                  </div>
                )}
                
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1 text-xs"
                    onClick={() => handleCopyTemplate(template)}
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 gap-1 text-xs"
                    onClick={() => handlePreview(template)}
                  >
                    <Edit className="w-3 h-3" />
                    Customize
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Preview & Edit Modal */}
      <AnimatePresence>
        {previewTemplate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setPreviewTemplate(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card rounded-2xl border border-border w-full max-w-lg shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-gradient-to-br ${previewTemplate.color} text-white`}>
                    {previewTemplate.icon}
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{previewTemplate.name}</h3>
                    <p className="text-xs text-muted-foreground">{previewTemplate.description}</p>
                  </div>
                </div>
              </div>
              
              {/* Content */}
              <div className="p-4 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Notification Title</label>
                  <Input
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    className="bg-secondary/50"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Notification Body</label>
                  <Textarea
                    value={editedBody}
                    onChange={(e) => setEditedBody(e.target.value)}
                    className="bg-secondary/50 min-h-[100px]"
                  />
                </div>
                
                {previewTemplate.variables && previewTemplate.variables.length > 0 && (
                  <div className="p-3 rounded-lg bg-secondary/30 border border-border/50">
                    <p className="text-xs text-muted-foreground">
                      <span className="text-foreground font-medium">Variables:</span> Replace {previewTemplate.variables.map(v => `{{${v}}}`).join(', ')} with actual values before sending.
                    </p>
                  </div>
                )}
                
                {/* Preview Card */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Preview</label>
                  <div className="p-4 rounded-xl bg-gradient-to-br from-secondary to-secondary/50 border border-border">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
                        <Bell className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{editedTitle}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{editedBody}</p>
                        <p className="text-[10px] text-muted-foreground mt-2">Vibely • now</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Footer */}
              <div className="p-4 border-t border-border flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setPreviewTemplate(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 gap-1"
                  onClick={handleUseTemplate}
                >
                  Use Template
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CampaignTemplatesLibrary;
