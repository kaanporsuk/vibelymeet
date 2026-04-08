import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Play,
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
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { resolveWebVibeVideoState } from "@/lib/vibeVideo/webVibeVideoState";
import { fetchMyProfile, updateMyProfile, type ProfileData } from "@/services/profileService";

const CAPTION_MAX = 50;

type StatusTone = {
  pillClassName: string;
  iconClassName: string;
  label: string;
  title: string;
  description: string;
};

const VibeStudio = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  const [isSavingCaption, setIsSavingCaption] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchMyProfile();
      setProfile(data);
    } catch (error) {
      console.error("Failed to load Vibe Studio profile:", error);
      toast.error("Could not load Vibe Studio right now.");
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile, refreshKey]);

  useEffect(() => {
    setCaptionDraft(profile?.vibeCaption ?? "");
  }, [profile?.vibeCaption]);

  const videoInfo = useMemo(
    () =>
      resolveWebVibeVideoState({
        bunnyVideoUid: profile?.bunnyVideoUid,
        bunnyVideoStatus: profile?.bunnyVideoStatus,
        vibeCaption: profile?.vibeCaption,
      }),
    [profile?.bunnyVideoUid, profile?.bunnyVideoStatus, profile?.vibeCaption],
  );

  useEffect(() => {
    setThumbnailError(false);
  }, [videoInfo.thumbnailUrl, videoInfo.uid]);

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
      case "uploading":
        return {
          pillClassName: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/25",
          iconClassName: "text-cyan-300",
          label: "Uploading",
          title: "Your upload is still in flight",
          description: "This is not treated as no video. Keep this page open or come back in a moment while we finish the upload.",
        };
      case "processing":
        return {
          pillClassName: "bg-violet-500/15 text-violet-300 border border-violet-500/25",
          iconClassName: "text-violet-300",
          label: "Processing",
          title: "We’re preparing your Vibe Video",
          description: "The clip is on file and being readied for playback now. This usually takes 15–30 seconds.",
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
          label: "No video yet",
          title: "Create your Vibe Video",
          description: "Give people a feel for your energy before the first chat. A strong 15 second take goes further than another static photo.",
        };
    }
  }, [readyAwaitingPlaybackUrl, videoInfo.state]);

  const refreshProfile = () => setRefreshKey((key) => key + 1);

  const handleCaptionSave = async () => {
    if (!profile || !captionChanged) return;
    setIsSavingCaption(true);
    try {
      const nextCaption = captionDraft.slice(0, CAPTION_MAX);
      await updateMyProfile({ vibeCaption: nextCaption });
      setProfile((prev) => (prev ? { ...prev, vibeCaption: nextCaption } : prev));
      toast.success("Caption saved.");
      refreshProfile();
    } catch (error) {
      toast.error(`Could not save caption: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSavingCaption(false);
    }
  };

  const handleDelete = async () => {
    if (!videoInfo.canDelete || isDeleting) return;

    const deletingPipelineVideo = videoInfo.state === "uploading" || videoInfo.state === "processing";
    const confirmed = window.confirm(
      deletingPipelineVideo
        ? "Delete this in-progress Vibe Video? This will cancel the current upload/processing attempt."
        : "Delete your current Vibe Video? This cannot be undone.",
    );

    if (!confirmed) return;

    setIsDeleting(true);
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

      setShowPlayer(false);
      toast.success(deletingPipelineVideo ? "In-progress Vibe Video removed." : "Vibe Video deleted.");
      refreshProfile();
    } catch (error) {
      toast.error(`Could not delete video: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleComposerSave = async (_uid: string, caption?: string) => {
    const nextCaption = (caption ?? "").slice(0, CAPTION_MAX);
    await updateMyProfile({ vibeCaption: nextCaption });
    setCaptionDraft(nextCaption);
    refreshProfile();
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
            <Button variant="outline" className="flex-1" onClick={loadProfile}>
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
              Record, replace, preview, and manage your Vibe Video from one dedicated surface. The backend media pipeline stays the same; this is just the studio you were missing.
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
                ) : videoInfo.state === "failed" || videoInfo.state === "error" ? (
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
            {hasPreview ? (
              <button
                type="button"
                onClick={() => setShowPlayer(true)}
                className="group relative w-full overflow-hidden rounded-[24px] border border-white/10 bg-secondary text-left"
                style={{ aspectRatio: "16/9" }}
              >
                {videoInfo.thumbnailUrl && !thumbnailError ? (
                  <img
                    src={videoInfo.thumbnailUrl}
                    alt="Current Vibe Video"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    onError={() => setThumbnailError(true)}
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-[#1C1A2E] to-[#0D0B1A]" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                <div className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300 backdrop-blur">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Ready
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-white/10 backdrop-blur">
                    <Play className="ml-1 h-7 w-7 text-white" />
                  </div>
                </div>
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-violet-200/90">Fullscreen preview</p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {videoInfo.caption ?? "Open your live video and preview it exactly as others see it."}
                  </p>
                </div>
              </button>
            ) : (
              <div className="rounded-[24px] border border-white/10 bg-black/20 px-5 py-10 text-center">
                {videoInfo.state === "none" ? (
                  <>
                    <Video className="mx-auto h-12 w-12 text-violet-300/60" />
                    <p className="mt-4 text-lg font-display font-semibold text-white">Start with a simple hello</p>
                    <p className="mt-2 text-sm leading-6 text-gray-400">
                      Good light, one sentence about your vibe, and a clear smile is enough for a strong first version.
                    </p>
                  </>
                ) : videoInfo.state === "failed" || videoInfo.state === "error" ? (
                  <>
                    <AlertCircle className="mx-auto h-12 w-12 text-amber-300/90" />
                    <p className="mt-4 text-lg font-display font-semibold text-white">This clip needs a fresh take</p>
                    <p className="mt-2 text-sm leading-6 text-gray-400">
                      Your caption is preserved, and you can replace the video below without touching the shared media pipeline.
                    </p>
                  </>
                ) : (
                  <>
                    <Loader2 className="mx-auto h-12 w-12 animate-spin text-violet-300" />
                    <p className="mt-4 text-lg font-display font-semibold text-white">
                      {videoInfo.state === "uploading" ? "Uploading your Vibe Video…" : "Processing your Vibe Video…"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-gray-400">
                      {videoInfo.state === "uploading"
                        ? "This still counts as having a video in progress. We’ll keep the state honest until playback is truly ready."
                        : "Playback is not ready yet, but the clip is on file and moving through the pipeline now."}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            {hasPreview ? (
              <Button variant="outline" className="flex-1" onClick={() => setShowPlayer(true)}>
                <Play className="h-4 w-4" />
                Fullscreen preview
              </Button>
            ) : null}
            <Button variant="gradient" className="flex-1" onClick={() => setShowComposer(true)}>
              <Video className="h-4 w-4" />
              {videoInfo.state === "none" ? "Create video" : "Replace video"}
            </Button>
            {videoInfo.canDelete ? (
              <Button variant="destructive" className="flex-1" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {videoInfo.state === "uploading" || videoInfo.state === "processing" ? "Cancel & delete" : "Delete"}
              </Button>
            ) : null}
          </div>
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
              {captionDraft.length}/{CAPTION_MAX}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            <Textarea
              value={captionDraft}
              onChange={(event) => setCaptionDraft(event.target.value.slice(0, CAPTION_MAX))}
              placeholder="What are you vibing on right now?"
              className="min-h-[120px] resize-none border-white/10 bg-black/20 text-white placeholder:text-gray-500"
              maxLength={CAPTION_MAX}
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
              If you&apos;re processing or uploading, that is still an in-progress video state, not an empty one.
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
              Failed clips are recoverable: replace them here instead of assuming the studio has no video on file.
            </div>
          </div>
        </section>
      </div>

      <VibeStudioModal
        open={showComposer}
        onOpenChange={setShowComposer}
        onSave={handleComposerSave}
        existingVideoUrl={videoInfo.playbackUrl ?? undefined}
        existingCaption={profile.vibeCaption}
      />

      <VibeVideoFullscreenPlayer
        show={showPlayer}
        bunnyVideoUid={profile.bunnyVideoUid}
        bunnyVideoStatus={profile.bunnyVideoStatus}
        vibeCaption={profile.vibeCaption}
        onClose={() => setShowPlayer(false)}
      />

      <BottomNav />
    </div>
  );
};

export default VibeStudio;
