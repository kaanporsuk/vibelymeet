import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import VibeStudioModal from "@/components/vibe-video/VibeStudioModal";
import { VibeVideoFullscreenPlayer } from "@/components/vibe-video/VibeVideoFullscreenPlayer";
import { HeroVideoStatusCard } from "@/components/hero-video/HeroVideoStatusCard";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";
import { trackVibeVideoEvent, VIBE_VIDEO_EVENTS } from "@/lib/vibeVideo/vibeVideoTelemetry";
import { recordUserAction } from "@/lib/browserDiagnostics";
import { MAX_VIBE_CAPTION_LEN } from "@/lib/vibeVideo/constants";
import { syncCurrentVibeVideoStatus } from "@/lib/vibeVideo/syncVibeVideoStatus";
import {
  fetchMyProfile,
  MY_PROFILE_STALE_TIME_MS,
  myProfileQueryKey,
  updateMyProfile,
  type ProfileData,
} from "@/services/profileService";
import { useHeroVideoUpload } from "@/hooks/useHeroVideoUpload";
import { heroVideoReset, heroVideoResumePollingForProfile } from "@/lib/heroVideo/heroVideoUploadController";
import { queryClient } from "@/lib/queryClient";
import { useUserProfile } from "@/contexts/AuthContext";

type StatusTone = {
  pillClassName: string;
  iconClassName: string;
  label: string;
  title: string;
  description: string;
};

const VibeStudio = () => {
  const navigate = useNavigate();
  const { user } = useUserProfile();
  const userId = user?.id ?? null;
  const ctrl = useHeroVideoUpload();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showComposer, setShowComposer] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  const [isSavingCaption, setIsSavingCaption] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadProfile = useCallback(async (forceFresh = false) => {
    if (!userId) {
      setProfile(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const data = await (forceFresh
        ? queryClient.fetchQuery({
            queryKey: myProfileQueryKey(userId),
            queryFn: () => fetchMyProfile(userId),
            staleTime: 0,
          })
        : queryClient.ensureQueryData({
            queryKey: myProfileQueryKey(userId),
            queryFn: () => fetchMyProfile(userId),
            staleTime: MY_PROFILE_STALE_TIME_MS,
          }));
      setProfile(data);
      if (data) {
        heroVideoResumePollingForProfile(
          {
            id: data.id,
            bunnyVideoUid: data.bunnyVideoUid,
            bunnyVideoStatus: data.bunnyVideoStatus,
            updatedAt: data.updatedAt,
          },
          { source: "profile_load" },
        );
      }
    } catch (error) {
      console.error("Failed to load Vibe Studio profile:", error);
      toast.error("Could not load Vibe Studio right now.");
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadProfile(refreshKey > 0);
  }, [loadProfile, refreshKey]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (!profile?.bunnyVideoUid) return;
      setRefreshKey((key) => key + 1);
      heroVideoResumePollingForProfile(
        {
          id: profile.id,
          bunnyVideoUid: profile.bunnyVideoUid,
          bunnyVideoStatus: profile.bunnyVideoStatus,
          updatedAt: profile.updatedAt,
        },
        { source: "visibility_active" },
      );
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [profile?.id, profile?.bunnyVideoUid, profile?.bunnyVideoStatus, profile?.updatedAt]);

  useEffect(() => {
    setCaptionDraft(profile?.vibeCaption ?? "");
  }, [profile?.vibeCaption]);

  // When the controller reaches terminal/timeout state, reload the profile
  // so Studio reflects backend truth without requiring a manual refresh.
  const prevPhaseRef = useRef<string>("idle");
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = ctrl.phase;
    const becameTerminal =
      (ctrl.phase === "ready" || ctrl.phase === "failed" || ctrl.phase === "stalled") &&
      prev !== ctrl.phase;
    const timedOutToIdle = (prev === "uploading" || prev === "processing") && ctrl.phase === "idle";
    if (becameTerminal || timedOutToIdle) {
      setRefreshKey((k) => k + 1);
    }
  }, [ctrl.phase]);

  const effectiveVibeVideo = useMemo(() => {
    if (ctrl.phase === "ready" && ctrl.videoId) {
      return {
        id: profile?.id ?? null,
        bunnyVideoUid: ctrl.videoId,
        bunnyVideoStatus: "ready",
        updatedAt: profile?.updatedAt ?? null,
        vibeCaption: profile?.vibeCaption ?? "",
      };
    }
    return {
      id: profile?.id ?? null,
      bunnyVideoUid: profile?.bunnyVideoUid ?? null,
      bunnyVideoStatus: profile?.bunnyVideoStatus ?? "none",
      updatedAt: profile?.updatedAt ?? null,
      vibeCaption: profile?.vibeCaption ?? "",
    };
  }, [
    ctrl.phase,
    ctrl.videoId,
    profile?.id,
    profile?.bunnyVideoUid,
    profile?.bunnyVideoStatus,
    profile?.updatedAt,
    profile?.vibeCaption,
  ]);

  const videoInfo = useMemo(
    () =>
      resolveWebVibeVideoState({
        bunnyVideoUid: effectiveVibeVideo.bunnyVideoUid,
        bunnyVideoStatus: effectiveVibeVideo.bunnyVideoStatus,
        vibeCaption: effectiveVibeVideo.vibeCaption,
      }),
    [effectiveVibeVideo],
  );

  const readyAwaitingPlaybackUrl = videoInfo.state === "ready" && !videoInfo.playbackUrl;
  const captionChanged = captionDraft !== (profile?.vibeCaption ?? "");

  const tone: StatusTone = useMemo(() => {
    if (readyAwaitingPlaybackUrl) {
      return {
        pillClassName: "bg-amber-500/15 text-amber-300 border border-amber-500/25",
        iconClassName: "text-amber-300",
        label: "Syncing preview",
        title: "Your video is ready on our side",
        description: "We have your clip, but the preview stream is still catching up. Refresh in a moment to check playback.",
      };
    }

    switch (videoInfo.state) {
      case "ready":
        return {
          pillClassName: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25",
          iconClassName: "text-emerald-300",
          label: "Ready",
          title: "Your Vibe Video is live",
          description: "Preview it full-screen, replace it with a stronger take, or fine-tune the caption shown on top.",
        };
      case "processing":
        return {
          pillClassName: "bg-violet-500/15 text-violet-300 border border-violet-500/25",
          iconClassName: "text-violet-300",
          label: "Processing",
          title: "We’re preparing your Vibe Video",
          description: "Your video uploaded and is still processing. This can take a few minutes. We'll keep checking.",
        };
      case "stale_processing":
        return {
          pillClassName: "bg-amber-500/15 text-amber-300 border border-amber-500/25",
          iconClassName: "text-amber-300",
          label: "Still processing",
          title: "Still processing",
          description: "You can refresh, try again later, or re-upload if it does not finish.",
        };
      case "failed":
        return {
          pillClassName: "bg-red-500/15 text-red-300 border border-red-500/25",
          iconClassName: "text-red-300",
          label: "Needs attention",
          title: "Processing didn’t finish",
          description: "Your last clip did not make it to a playable state. Record or upload a new take to replace it.",
        };
      case "error":
        return {
          pillClassName: "bg-amber-500/15 text-amber-300 border border-amber-500/25",
          iconClassName: "text-amber-300",
          label: "Status mismatch",
          title: "The current video state looks inconsistent",
          description: "The backend still has video metadata, but this client cannot confidently present it yet. Refresh, replace, or delete if it stays stuck.",
        };
      default:
        return {
          pillClassName: "bg-white/10 text-violet-200 border border-white/10",
          iconClassName: "text-violet-300",
          label: "Create",
          title: "Create your Vibe Video",
          description: "Give people a feel for your energy before the first chat. A strong 15 second take goes further than another static photo.",
        };
    }
  }, [readyAwaitingPlaybackUrl, videoInfo.state]);

  const refreshProfile = async () => {
    await syncCurrentVibeVideoStatus(effectiveVibeVideo.bunnyVideoUid, "manual_refresh");
    setRefreshKey((key) => key + 1);
    heroVideoResumePollingForProfile(effectiveVibeVideo, { source: "manual_refresh" });
  };

  const handleCaptionSave = async () => {
    if (!profile || !captionChanged) return;
    recordUserAction("vibe_studio_caption_save_clicked", {
      surface: "vibe_studio",
      video_state: videoInfo.state,
      caption_length_bucket: captionDraft.trim().length > 80 ? "long" : captionDraft.trim().length > 0 ? "short" : "empty",
    });
    setIsSavingCaption(true);
    try {
      const nextCaption = captionDraft.slice(0, MAX_VIBE_CAPTION_LEN);
      await updateMyProfile({ vibeCaption: nextCaption });
      const previousCaption = profile.vibeCaption.trim();
      if (previousCaption && !nextCaption.trim()) {
        trackVibeVideoEvent(VIBE_VIDEO_EVENTS.captionCleared, { source: "vibe_studio_page" });
      } else {
        trackVibeVideoEvent(VIBE_VIDEO_EVENTS.captionEdited, {
          source: "vibe_studio_page",
          had_existing_caption: previousCaption.length > 0,
        });
      }
      setProfile((prev) => (prev ? { ...prev, vibeCaption: nextCaption } : prev));
      if (userId) {
        queryClient.setQueryData<ProfileData | null>(myProfileQueryKey(userId), (prev) =>
          prev ? { ...prev, vibeCaption: nextCaption } : prev,
        );
      }
      recordUserAction("vibe_studio_caption_save_succeeded", {
        surface: "vibe_studio",
        video_state: videoInfo.state,
      });
      toast.success("Caption saved.");
      refreshProfile();
    } catch (error) {
      recordUserAction("vibe_studio_caption_save_failed", {
        surface: "vibe_studio",
        video_state: videoInfo.state,
      });
      toast.error(`Could not save caption: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSavingCaption(false);
    }
  };

  const handleDelete = async () => {
    if (!videoInfo.canDelete || isDeleting) return;

    const deletingPipelineVideo = videoInfo.state === "processing" || videoInfo.state === "stale_processing";
    const confirmed = window.confirm(
      deletingPipelineVideo
        ? "Delete this in-progress Vibe Video? This will cancel the current upload/processing attempt."
        : "Delete your current Vibe Video? This cannot be undone.",
    );

    if (!confirmed) return;

    setIsDeleting(true);
    recordUserAction("vibe_studio_delete_clicked", {
      surface: "vibe_studio",
      video_state: videoInfo.state,
      deleting_pipeline_video: deletingPipelineVideo,
    });
    trackVibeVideoEvent(VIBE_VIDEO_EVENTS.deleteRequested, {
      source: "vibe_studio_page",
      state: videoInfo.state,
    });
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-vibe-video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) {
        throw new Error(String(result.error ?? "Failed to delete video."));
      }

      recordUserAction("vibe_studio_delete_succeeded", {
        surface: "vibe_studio",
        video_state: videoInfo.state,
        possible_bunny_orphan: result.possibleBunnyOrphan === true,
      });
      trackVibeVideoEvent(VIBE_VIDEO_EVENTS.deleteSucceededLocally, {
        source: "vibe_studio_page",
        state: videoInfo.state,
        possible_bunny_orphan: result.possibleBunnyOrphan === true,
      });
      heroVideoReset();
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              bunnyVideoUid: null,
              bunnyVideoStatus: "none",
              vibeCaption: "",
            }
          : prev,
      );
      if (userId) {
        queryClient.setQueryData<ProfileData | null>(myProfileQueryKey(userId), (prev) =>
          prev
            ? {
                ...prev,
                bunnyVideoUid: null,
                bunnyVideoStatus: "none",
                vibeCaption: "",
              }
            : prev,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      setShowPlayer(false);
      setCaptionDraft("");
      toast.success(deletingPipelineVideo ? "In-progress Vibe Video removed." : "Vibe Video deleted.");
      refreshProfile();
    } catch (error) {
      recordUserAction("vibe_studio_delete_failed", {
        surface: "vibe_studio",
        video_state: videoInfo.state,
      });
      toast.error(`Could not delete video: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto flex max-w-lg flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-300" />
          <div>
            <h1 className="text-xl font-display font-semibold text-white">Couldn&apos;t open Vibe Studio</h1>
            <p className="mt-2 text-sm text-gray-400">
              We couldn&apos;t load your profile details right now. Try again or head back to Profile Studio.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="outline" className="flex-1" onClick={() => void loadProfile(true)}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
            <Button variant="gradient" className="flex-1" onClick={() => navigate("/profile")}>
              Back to profile
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const hasPreview = videoInfo.state === "ready" && videoInfo.canPlay;

  return (
    <div className="min-h-screen bg-background pb-[100px]">
      <div className="relative overflow-hidden border-b border-white/5 bg-[radial-gradient(circle_at_top_left,_rgba(139,92,246,0.4),_transparent_42%),linear-gradient(135deg,_rgba(10,8,24,1)_0%,_rgba(25,22,50,1)_45%,_rgba(12,10,26,1)_100%)]">
        <div className="mx-auto max-w-lg px-4 pb-10 pt-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" className="rounded-full bg-black/25 text-white hover:bg-black/35" onClick={() => navigate("/profile")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-violet-200">
              <Sparkles className="h-3.5 w-3.5" />
              Vibe Studio
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <h1 className="max-w-md text-3xl font-display font-bold text-white">Show your energy before the first chat.</h1>
            <p className="max-w-md text-sm leading-6 text-gray-300">
              Record, replace, preview, and manage the video people see on your profile.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-5">
        <section className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold", tone.pillClassName)}>
                {videoInfo.state === "ready" ? (
                  <CheckCircle2 className={cn("h-3.5 w-3.5", tone.iconClassName)} />
                ) : videoInfo.state === "failed" || videoInfo.state === "error" || videoInfo.state === "stale_processing" ? (
                  <AlertCircle className={cn("h-3.5 w-3.5", tone.iconClassName)} />
                ) : videoInfo.state === "none" ? (
                  <Video className={cn("h-3.5 w-3.5", tone.iconClassName)} />
                ) : (
                  <Loader2 className={cn("h-3.5 w-3.5 animate-spin", tone.iconClassName)} />
                )}
                {tone.label}
              </div>
              <div>
                <h2 className="text-xl font-display font-semibold text-white">{tone.title}</h2>
                <p className="mt-1 text-sm leading-6 text-gray-400">{tone.description}</p>
              </div>
            </div>

            <Button variant="outline" className="shrink-0" onClick={refreshProfile}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>

          <div className="mt-5">
            <HeroVideoStatusCard
              profile={effectiveVibeVideo}
              onOpenRecorder={() => {
                recordUserAction("vibe_studio_recorder_open_clicked", {
                  surface: "vibe_studio",
                  video_state: videoInfo.state,
                });
                setShowComposer(true);
              }}
              onOpenPlayer={() => setShowPlayer(true)}
              onRefresh={refreshProfile}
            />
          </div>

          {videoInfo.canDelete && (
            <div className="mt-3">
              <Button variant="destructive" className="w-full" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {videoInfo.state === "processing" || videoInfo.state === "stale_processing" ? "Cancel & delete" : "Delete video"}
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-display font-semibold text-white">Caption</h2>
              <p className="mt-1 text-sm leading-6 text-gray-400">
                This text appears over your Vibe Video in playback. Keep it specific, current, and easy to react to.
              </p>
            </div>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold text-gray-400">
              {captionDraft.length}/{MAX_VIBE_CAPTION_LEN}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            <Textarea
              value={captionDraft}
              onChange={(event) => setCaptionDraft(event.target.value.slice(0, MAX_VIBE_CAPTION_LEN))}
              placeholder="What are you vibing on right now?"
              className="min-h-[120px] resize-none border-white/10 bg-black/20 text-white placeholder:text-gray-500"
              maxLength={MAX_VIBE_CAPTION_LEN}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-gray-500">
                You can update the caption while your video is ready, processing, or waiting for a fresh take.
              </p>
              <Button variant="gradient" onClick={handleCaptionSave} disabled={!captionChanged || isSavingCaption}>
                {isSavingCaption ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save caption
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur">
          <h2 className="text-lg font-display font-semibold text-white">Studio guidance</h2>
          <div className="mt-4 grid gap-3 text-sm leading-6 text-gray-400">
            <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
              Lead with a real sentence about what kind of energy, plan, or connection you&apos;re looking for.
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
              If your video is still preparing, you can leave this screen and check back in a moment.
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
              Failed clips are recoverable: replace them here instead of assuming the studio is empty.
            </div>
          </div>
        </section>
      </div>

      <VibeStudioModal
        open={showComposer}
        onOpenChange={setShowComposer}
        hasExistingVideo={!!effectiveVibeVideo.bunnyVideoUid}
        existingCaption={profile.vibeCaption}
      />

      <VibeVideoFullscreenPlayer
        show={showPlayer}
        bunnyVideoUid={effectiveVibeVideo.bunnyVideoUid}
        bunnyVideoStatus={effectiveVibeVideo.bunnyVideoStatus}
        vibeCaption={effectiveVibeVideo.vibeCaption}
        onClose={() => setShowPlayer(false)}
      />

      <BottomNav />
    </div>
  );
};

export default VibeStudio;
