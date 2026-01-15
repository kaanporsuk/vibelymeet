import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Scissors, Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VideoTrimmerProps {
  videoUrl: string;
  maxDuration?: number; // Maximum clip duration in seconds
  onTrimComplete: (trimmedBlob: Blob, startTime: number, endTime: number) => void;
  onCancel: () => void;
}

export const VideoTrimmer = ({
  videoUrl,
  maxDuration = 15,
  onTrimComplete,
  onCancel,
}: VideoTrimmerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [range, setRange] = useState<[number, number]>([0, maxDuration]);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);

  // Load video and generate thumbnails
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      const videoDuration = video.duration;
      setDuration(videoDuration);
      
      // Set initial range
      const endTime = Math.min(maxDuration, videoDuration);
      setRange([0, endTime]);
      
      // Generate thumbnails for timeline
      generateThumbnails(video, videoDuration);
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => video.removeEventListener("loadedmetadata", handleLoadedMetadata);
  }, [videoUrl, maxDuration]);

  // Update current time display during playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);
      
      // Loop within the selected range
      if (time >= range[1]) {
        video.currentTime = range[0];
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [range]);

  const generateThumbnails = async (video: HTMLVideoElement, videoDuration: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const thumbCount = 8;
    const thumbs: string[] = [];
    
    canvas.width = 80;
    canvas.height = 60;

    for (let i = 0; i < thumbCount; i++) {
      const time = (i / thumbCount) * videoDuration;
      video.currentTime = time;
      
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          thumbs.push(canvas.toDataURL("image/jpeg", 0.5));
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
      });
    }

    setThumbnails(thumbs);
    video.currentTime = 0;
  };

  const handleRangeChange = (values: number[]) => {
    const [start, end] = values;
    const clampedDuration = Math.min(end - start, maxDuration);
    
    // If duration exceeds max, adjust the end point
    if (end - start > maxDuration) {
      setRange([start, start + maxDuration]);
    } else {
      setRange([start, end]);
    }

    // Seek video to start of range
    if (videoRef.current) {
      videoRef.current.currentTime = start;
    }
  };

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.currentTime = range[0];
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [range]);

  const seekToStart = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = range[0];
      setCurrentTime(range[0]);
    }
  };

  const seekToEnd = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = range[1] - 0.1;
      setCurrentTime(range[1] - 0.1);
    }
  };

  const handleTrim = async () => {
    const video = videoRef.current;
    if (!video) return;

    setIsProcessing(true);
    setProcessingProgress(0);

    try {
      const [startTime, endTime] = range;
      const clipDuration = endTime - startTime;

      // Create a canvas for video processing
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get canvas context");

      // Setup MediaRecorder
      const stream = canvas.captureStream(30);
      
      // Try to capture audio too
      try {
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        source.connect(audioCtx.destination);
        
        dest.stream.getAudioTracks().forEach(track => {
          stream.addTrack(track);
        });
      } catch (audioErr) {
        console.warn("Could not capture audio:", audioErr);
      }

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm";

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 2500000,
      });

      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const recordingPromise = new Promise<Blob>((resolve) => {
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          resolve(blob);
        };
      });

      // Start recording and play video
      video.currentTime = startTime;
      await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
      
      mediaRecorder.start(100);
      video.play();

      // Draw frames and track progress
      const drawFrame = () => {
        if (video.currentTime >= endTime || video.paused) {
          video.pause();
          mediaRecorder.stop();
          return;
        }

        ctx.drawImage(video, 0, 0);
        const progress = ((video.currentTime - startTime) / clipDuration) * 100;
        setProcessingProgress(Math.min(progress, 99));
        requestAnimationFrame(drawFrame);
      };

      video.onplay = () => drawFrame();

      // Wait for recording to complete
      const trimmedBlob = await recordingPromise;
      setProcessingProgress(100);

      onTrimComplete(trimmedBlob, startTime, endTime);
    } catch (error) {
      console.error("Trim failed:", error);
      // Fallback: just pass the original video through
      const response = await fetch(videoUrl);
      const blob = await response.blob();
      onTrimComplete(blob, range[0], range[1]);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const clipDuration = range[1] - range[0];

  return (
    <div className="flex flex-col h-full">
      {/* Video Preview */}
      <div className="relative flex-1 bg-secondary overflow-hidden">
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-contain"
          playsInline
          muted={false}
          onClick={togglePlayback}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center gap-4">
            <Scissors className="w-10 h-10 text-primary animate-pulse" />
            <div className="w-48">
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${processingProgress}%` }}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Trimming video... {Math.round(processingProgress)}%
            </p>
          </div>
        )}

        {/* Play indicator */}
        {!isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: isPlaying ? 0 : 1 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="w-16 h-16 rounded-full bg-background/50 backdrop-blur-sm flex items-center justify-center">
              <Play className="w-8 h-8 text-foreground ml-1" />
            </div>
          </motion.div>
        )}
      </div>

      {/* Trimming Controls */}
      <div className="p-4 bg-background border-t border-border space-y-4">
        {/* Timeline with thumbnails */}
        <div className="relative">
          {/* Thumbnail strip */}
          <div className="flex h-12 rounded-lg overflow-hidden mb-2">
            {thumbnails.length > 0 ? (
              thumbnails.map((thumb, i) => (
                <img
                  key={i}
                  src={thumb}
                  alt=""
                  className="flex-1 object-cover"
                />
              ))
            ) : (
              <div className="flex-1 bg-secondary animate-pulse" />
            )}
          </div>

          {/* Range slider overlay */}
          <div className="absolute inset-x-0 top-0 h-12 flex items-center px-2">
            {/* Selected range highlight */}
            <div
              className="absolute h-full border-2 border-primary bg-primary/10 rounded"
              style={{
                left: `${(range[0] / duration) * 100}%`,
                width: `${((range[1] - range[0]) / duration) * 100}%`,
              }}
            />
          </div>

          {/* Dual range slider */}
          <Slider
            value={range}
            min={0}
            max={duration || 100}
            step={0.1}
            onValueChange={handleRangeChange}
            className="mt-2"
          />
        </div>

        {/* Time info */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {formatTime(range[0])} - {formatTime(range[1])}
          </span>
          <span className={cn(
            "font-medium",
            clipDuration > maxDuration ? "text-destructive" : "text-primary"
          )}>
            {formatTime(clipDuration)} / {maxDuration}s max
          </span>
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-4">
          <Button variant="ghost" size="icon" onClick={seekToStart}>
            <SkipBack className="w-5 h-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={togglePlayback}
            className="w-12 h-12 rounded-full"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" />
            )}
          </Button>
          <Button variant="ghost" size="icon" onClick={seekToEnd}>
            <SkipForward className="w-5 h-5" />
          </Button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onCancel}
            className="flex-1"
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleTrim}
            className="flex-1"
            disabled={isProcessing || clipDuration > maxDuration}
          >
            <Scissors className="w-4 h-4 mr-2" />
            {duration <= maxDuration ? "Use Full Video" : "Trim to 15s"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VideoTrimmer;
