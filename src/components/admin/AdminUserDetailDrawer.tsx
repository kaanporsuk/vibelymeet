import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  X,
  User,
  Mail,
  MapPin,
  Calendar,
  Heart,
  MessageSquare,
  Ruler,
  Briefcase,
  Image,
  Video,
  Check,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Shield,
  Ban,
  Eye,
  MessagesSquare,
  Loader2,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import UserModerationActions from "./UserModerationActions";
import AdminProfilePreview from "./AdminProfilePreview";
import AdminMatchMessagesDrawer from "./AdminMatchMessagesDrawer";
import AdminPhotoLightbox from "./AdminPhotoLightbox";
import { getSignedPhotoUrl, extractPathFromSignedUrl, isSignedUrlExpiring } from "@/services/storageService";
import { resolvePhotoUrl } from "@/lib/photoUtils";
import AdminGrantCreditsModal from "./AdminGrantCreditsModal";


interface AdminUserDetailDrawerProps {
  userId: string;
  onClose: () => void;
}

const AdminUserDetailDrawer = ({ userId, onClose }: AdminUserDetailDrawerProps) => {
  const [showModeration, setShowModeration] = useState(false);
  const [showProfilePreview, setShowProfilePreview] = useState(false);
  const [showMatchMessages, setShowMatchMessages] = useState(false);
  const [showGrantCredits, setShowGrantCredits] = useState(false);
  const [refreshedPhotos, setRefreshedPhotos] = useState<string[]>([]);
  const [isRefreshingPhotos, setIsRefreshingPhotos] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);

  // Fetch user profile
  const { data: profile, isLoading } = useQuery({
    queryKey: ['admin-user-detail', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch user vibes
  const { data: vibes } = useQuery({
    queryKey: ['admin-user-vibes', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('profile_vibes')
        .select(`
          vibe_tags (
            label,
            emoji,
            category
          )
        `)
        .eq('profile_id', userId);
      return data?.map(v => v.vibe_tags) || [];
    },
  });

  // Fetch user matches
  const { data: matches } = useQuery({
    queryKey: ['admin-user-matches', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('matches')
        .select(`
          id,
          matched_at,
          profile_id_1,
          profile_id_2
        `)
        .or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`)
        .order('matched_at', { ascending: false })
        .limit(20);
      return data || [];
    },
  });

  // Fetch match profiles
  const { data: matchProfiles } = useQuery({
    queryKey: ['admin-match-profiles', matches],
    queryFn: async () => {
      if (!matches?.length) return {};
      
      const otherUserIds = matches.map(m => 
        m.profile_id_1 === userId ? m.profile_id_2 : m.profile_id_1
      );
      
      const { data } = await supabase
        .from('profiles')
        .select('id, name, avatar_url, photos')
        .in('id', otherUserIds);
      
      const profileMap: Record<string, { name: string; avatar_url: string | null; photos: string[] | null }> = {};
      data?.forEach(p => {
        profileMap[p.id] = p;
      });
      return profileMap;
    },
    enabled: !!matches?.length,
  });

  // Fetch daily drops (likes/passes)
  const { data: dailyDrops } = useQuery({
    queryKey: ['admin-user-drops', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('daily_drops')
        .select(`
          id,
          candidate_id,
          status,
          drop_date,
          created_at
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      return data || [];
    },
  });

  // Fetch candidate profiles for drops
  const { data: dropProfiles } = useQuery({
    queryKey: ['admin-drop-profiles', dailyDrops],
    queryFn: async () => {
      if (!dailyDrops?.length) return {};
      
      const candidateIds = dailyDrops.map(d => d.candidate_id);
      
      const { data } = await supabase
        .from('profiles')
        .select('id, name, avatar_url, photos')
        .in('id', candidateIds);
      
      const profileMap: Record<string, { name: string; avatar_url: string | null; photos: string[] | null }> = {};
      data?.forEach(p => {
        profileMap[p.id] = p;
      });
      return profileMap;
    },
    enabled: !!dailyDrops?.length,
  });

  // Fetch auth user email
  const { data: authUser } = useQuery({
    queryKey: ['admin-user-auth', userId],
    queryFn: async () => {
      // Get from verified_email field in profiles
      return profile?.verified_email;
    },
    enabled: !!profile,
  });

  // Refresh signed URLs for photos
  useEffect(() => {
    if (!profile?.photos?.length) {
      setRefreshedPhotos([]);
      return;
    }

    const refreshPhotos = async () => {
      setIsRefreshingPhotos(true);
      const refreshed: string[] = [];
      for (const url of profile.photos) {
        if (url) {
          if (isSignedUrlExpiring(url)) {
            const path = extractPathFromSignedUrl(url);
            if (path) {
              const newUrl = await getSignedPhotoUrl(path);
              refreshed.push(newUrl || url);
            } else {
              refreshed.push(url);
            }
          } else {
            refreshed.push(url);
          }
        }
      }
      setRefreshedPhotos(refreshed);
      setIsRefreshingPhotos(false);
    };

    refreshPhotos();
  }, [profile?.photos]);

  // Resolve Bunny CDN video URL
  useEffect(() => {
    if (!profile?.bunny_video_uid || (profile as any).bunny_video_status !== "ready") {
      setVideoUrl(null);
      setIsLoadingVideo(false);
      return;
    }
    setVideoUrl(
      `https://${import.meta.env.VITE_BUNNY_STREAM_CDN_HOSTNAME}/${profile.bunny_video_uid}/playlist.m3u8`
    );
    setIsLoadingVideo(false);
  }, [profile?.bunny_video_uid, (profile as any)?.bunny_video_status]);

  const displayPhotos = refreshedPhotos.length > 0 ? refreshedPhotos : profile?.photos || [];

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
      />

      {/* Drawer */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background border-l border-border z-50 overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-xl font-bold font-display text-foreground">User Profile</h2>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowProfilePreview(true)}
              className="gap-2"
            >
              <Eye className="w-4 h-4" />
              Preview
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowMatchMessages(true)}
              className="gap-2"
            >
              <MessagesSquare className="w-4 h-4" />
              Messages
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowGrantCredits(true)}
              className="gap-2 text-primary border-primary/30 hover:bg-primary/10"
            >
              <Sparkles className="w-4 h-4" />
              Credits
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowModeration(true)}
              className="gap-2 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/10"
            >
              <Shield className="w-4 h-4" />
              Moderate
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 bg-secondary/50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : profile ? (
            <div className="p-6 space-y-6">
              {/* Profile Header */}
              <div className="flex items-start gap-4">
                <Avatar className="h-24 w-24 border-4 border-border">
                  <AvatarImage src={resolvePhotoUrl(profile.avatar_url) || resolvePhotoUrl(profile.photos?.[0])} />
                  <AvatarFallback className="bg-primary/20 text-primary text-2xl">
                    {profile.name?.[0]?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-2xl font-bold text-foreground">{profile.name}</h3>
                    <span className="text-lg text-muted-foreground">{profile.age}</span>
                    {profile.photo_verified && (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                        <Check className="w-3 h-3 mr-1" />
                        Verified
                      </Badge>
                    )}
                    {profile.is_suspended && (
                      <Badge className="bg-destructive/20 text-destructive border-destructive/30">
                        <Ban className="w-3 h-3 mr-1" />
                        Suspended
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{profile.tagline || profile.bio}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="gap-1">
                      <User className="w-3 h-3" />
                      {profile.gender}
                    </Badge>
                    {profile.location && (
                      <Badge variant="outline" className="gap-1">
                        <MapPin className="w-3 h-3" />
                        {profile.location}
                      </Badge>
                    )}
                    {profile.height_cm && (
                      <Badge variant="outline" className="gap-1">
                        <Ruler className="w-3 h-3" />
                        {profile.height_cm}cm
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="glass-card p-4 rounded-xl text-center">
                  <Heart className="w-5 h-5 text-pink-400 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-foreground">{profile.total_matches || 0}</p>
                  <p className="text-xs text-muted-foreground">Matches</p>
                </div>
                <div className="glass-card p-4 rounded-xl text-center">
                  <MessageSquare className="w-5 h-5 text-cyan-400 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-foreground">{profile.total_conversations || 0}</p>
                  <p className="text-xs text-muted-foreground">Conversations</p>
                </div>
                <div className="glass-card p-4 rounded-xl text-center">
                  <Calendar className="w-5 h-5 text-orange-400 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-foreground">{profile.events_attended || 0}</p>
                  <p className="text-xs text-muted-foreground">Events</p>
                </div>
              </div>

              {/* Tabs */}
              <Tabs defaultValue="info" className="w-full">
                <TabsList className="w-full bg-secondary/50">
                  <TabsTrigger value="info" className="flex-1">Info</TabsTrigger>
                  <TabsTrigger value="photos" className="flex-1">Photos</TabsTrigger>
                  <TabsTrigger value="activity" className="flex-1">Activity</TabsTrigger>
                  <TabsTrigger value="matches" className="flex-1">Matches</TabsTrigger>
                </TabsList>

                <TabsContent value="info" className="space-y-4 mt-4">
                  {/* Personal Info */}
                  <div className="glass-card p-4 rounded-xl space-y-3">
                    <h4 className="font-semibold text-foreground">Personal Information</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Email</p>
                        <p className="text-foreground">{profile.verified_email || 'Not verified'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Birthday</p>
                        <p className="text-foreground">
                          {profile.birth_date ? format(new Date(profile.birth_date), 'MMM d, yyyy') : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Looking For</p>
                        <p className="text-foreground">{profile.looking_for || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Job</p>
                        <p className="text-foreground">{profile.job || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Company</p>
                        <p className="text-foreground">{profile.company || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Interested In</p>
                        <p className="text-foreground">{profile.interested_in?.join(', ') || 'N/A'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Vibes */}
                  <div className="glass-card p-4 rounded-xl space-y-3">
                    <h4 className="font-semibold text-foreground flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Vibes
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {vibes?.map((vibe: any, i: number) => (
                        <Badge key={i} variant="secondary" className="gap-1">
                          {vibe?.emoji} {vibe?.label}
                        </Badge>
                      ))}
                      {(!vibes || vibes.length === 0) && (
                        <p className="text-sm text-muted-foreground">No vibes selected</p>
                      )}
                    </div>
                  </div>

                  {/* Account Info */}
                  <div className="glass-card p-4 rounded-xl space-y-3">
                    <h4 className="font-semibold text-foreground">Account Details</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Created</p>
                        <p className="text-foreground">
                          {format(new Date(profile.created_at), 'MMM d, yyyy HH:mm')}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Last Updated</p>
                        <p className="text-foreground">
                          {format(new Date(profile.updated_at), 'MMM d, yyyy HH:mm')}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Email Verified</p>
                        <p className={profile.email_verified ? 'text-green-400' : 'text-muted-foreground'}>
                          {profile.email_verified ? 'Yes' : 'No'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Photo Verified</p>
                        <p className={profile.photo_verified ? 'text-green-400' : 'text-muted-foreground'}>
                          {profile.photo_verified ? 'Yes' : 'No'}
                        </p>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="photos" className="mt-4">
                  {isRefreshingPhotos ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-muted-foreground">Loading photos...</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {displayPhotos.map((photo: string, i: number) => (
                        <motion.div 
                          key={i} 
                          className="aspect-square rounded-xl overflow-hidden bg-secondary/50 cursor-pointer relative group"
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => openLightbox(i)}
                        >
                          <img
                            src={photo}
                            alt={`Photo ${i + 1}`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // If image fails to load, try refreshing the URL
                              const target = e.target as HTMLImageElement;
                              target.src = '/placeholder.svg';
                            }}
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <ZoomIn className="w-6 h-6 text-white" />
                          </div>
                        </motion.div>
                      ))}
                      {displayPhotos.length === 0 && (
                        <div className="col-span-3 text-center py-8 text-muted-foreground">
                          No photos uploaded
                        </div>
                      )}
                    </div>
                  )}
                  {profile.video_intro_url && (
                    <div className="mt-4">
                      <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                        <Video className="w-4 h-4" />
                        Video Intro
                      </h4>
                      {isLoadingVideo ? (
                        <div className="aspect-video rounded-xl bg-secondary/50 flex items-center justify-center">
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : videoUrl ? (
                        <video
                          src={videoUrl}
                          controls
                          className="w-full rounded-xl"
                        />
                      ) : (
                        <div className="aspect-video rounded-xl bg-secondary/50 flex items-center justify-center text-muted-foreground">
                          Video not available
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="activity" className="mt-4 space-y-4">
                  <h4 className="font-semibold text-foreground">Daily Drop Activity</h4>
                  <div className="space-y-2">
                    {dailyDrops?.map((drop) => {
                      const candidate = dropProfiles?.[drop.candidate_id];
                      return (
                        <div key={drop.id} className="glass-card p-3 rounded-xl flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={resolvePhotoUrl(candidate?.avatar_url) || resolvePhotoUrl(candidate?.photos?.[0])} />
                            <AvatarFallback>{candidate?.name?.[0] || '?'}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">
                              {candidate?.name || 'Unknown'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(drop.created_at), 'MMM d, yyyy')}
                            </p>
                          </div>
                          <Badge 
                            variant="outline"
                            className={
                              drop.status === 'replied' || drop.status === 'matched'
                                ? 'bg-green-500/10 text-green-400 border-green-500/30'
                                : drop.status === 'passed'
                                ? 'bg-red-500/10 text-red-400 border-red-500/30'
                                : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
                            }
                          >
                            {drop.status === 'replied' && <ThumbsUp className="w-3 h-3 mr-1" />}
                            {drop.status === 'passed' && <ThumbsDown className="w-3 h-3 mr-1" />}
                            {drop.status === 'pending' && <Clock className="w-3 h-3 mr-1" />}
                            {drop.status}
                          </Badge>
                        </div>
                      );
                    })}
                    {(!dailyDrops || dailyDrops.length === 0) && (
                      <p className="text-center py-8 text-muted-foreground">No activity recorded</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="matches" className="mt-4 space-y-4">
                  <h4 className="font-semibold text-foreground">Matches ({matches?.length || 0})</h4>
                  <div className="space-y-2">
                    {matches?.map((match) => {
                      const otherId = match.profile_id_1 === userId ? match.profile_id_2 : match.profile_id_1;
                      const otherUser = matchProfiles?.[otherId];
                      return (
                        <div key={match.id} className="glass-card p-3 rounded-xl flex items-center gap-3">
                          <Avatar className="h-10 w-10 border-2 border-pink-500/30">
                            <AvatarImage src={resolvePhotoUrl(otherUser?.avatar_url) || resolvePhotoUrl(otherUser?.photos?.[0])} />
                            <AvatarFallback>{otherUser?.name?.[0] || '?'}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">
                              {otherUser?.name || 'Unknown'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Matched {format(new Date(match.matched_at), 'MMM d, yyyy')}
                            </p>
                          </div>
                          <Heart className="w-4 h-4 text-pink-400" />
                        </div>
                      );
                    })}
                    {(!matches || matches.length === 0) && (
                      <p className="text-center py-8 text-muted-foreground">No matches yet</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <div className="p-6 text-center text-muted-foreground">
              User not found
            </div>
          )}
        </ScrollArea>
      </motion.div>

      {/* Moderation Modal */}
      {profile && (
        <UserModerationActions
          userId={userId}
          userName={profile.name || 'User'}
          isOpen={showModeration}
          onClose={() => setShowModeration(false)}
        />
      )}

      {/* Profile Preview Modal */}
      <AdminProfilePreview
        userId={userId}
        isOpen={showProfilePreview}
        onClose={() => setShowProfilePreview(false)}
      />

      {/* Match Messages Drawer */}
      {profile && (
        <AdminMatchMessagesDrawer
          userId={userId}
          userName={profile.name || 'User'}
          isOpen={showMatchMessages}
          onClose={() => setShowMatchMessages(false)}
        />
      )}

      {/* Photo Lightbox */}
      <AdminPhotoLightbox
        photos={displayPhotos}
        initialIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />

      {/* Grant Credits Modal */}
      {profile && (
        <AdminGrantCreditsModal
          userId={userId}
          userName={profile.name || 'User'}
          isOpen={showGrantCredits}
          onClose={() => setShowGrantCredits(false)}
        />
      )}
    </>
  );
};

export default AdminUserDetailDrawer;