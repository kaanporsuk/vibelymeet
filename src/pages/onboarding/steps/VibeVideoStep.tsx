import { useRef, useState } from "react";
import { Video, Upload, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface VibeVideoStepProps {
  onNext: () => void;
  onSkip: () => void;
  onVideoUploaded: (videoUid: string) => void;
  userId: string;
}

export const VibeVideoStep = ({ onNext, onSkip, onVideoUploaded, userId }: VibeVideoStepProps) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const uploadVideo = async (file: File) => {
    if (file.size > 100 * 1024 * 1024) {
      toast.error("Video must be under 100 MB.");
      return;
    }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const credRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-video-upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );
      const creds = await credRes.json().catch(() => ({}));
      if (!creds.uploadUrl || !creds.videoId) throw new Error("Failed to get upload credentials");

      await fetch(creds.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "video/mp4" },
        body: file,
      });

      await supabase
        .from("profiles")
        .update({ bunny_video_uid: creds.videoId, bunny_video_status: "processing" })
        .eq("id", userId);

      onVideoUploaded(creds.videoId);
      toast.success("Your Vibe Video is processing!");
      onNext();
    } catch (err: any) {
      toast.error(err?.message || "Video upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      if (video.duration > 31) {
        toast.error("Video must be 30 seconds or shorter.");
        return;
      }
      uploadVideo(file);
    };
  };

  return (
    <div className="flex flex-col gap-6 pt-12 items-center text-center">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          Stand out with a Vibe Video
        </h1>
        <p className="text-muted-foreground mt-2">
          30-second intro videos get more engagement.
        </p>
      </div>

      <div className="w-full aspect-[9/16] max-w-[200px] rounded-2xl glass-card flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
            <Play className="w-6 h-6 text-primary" />
          </div>
          <p className="text-xs text-muted-foreground">Preview your vibe intro here</p>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="w-full space-y-3">
        <Button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
        >
          {uploading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Video className="w-4 h-4" /> Record or upload a video
            </span>
          )}
        </Button>

        <button
          onClick={onSkip}
          disabled={uploading}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors w-full text-center"
        >
          I'll do this later
        </button>
      </div>
    </div>
  );
};
