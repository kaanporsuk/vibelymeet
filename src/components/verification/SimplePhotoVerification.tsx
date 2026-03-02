import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, RotateCcw, Check, AlertCircle, Loader2, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SimplePhotoVerificationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onVerificationComplete: (success: boolean) => void;
}

type Screen = "intro" | "camera" | "preview" | "uploading" | "success" | "error";

export function SimplePhotoVerification({
  open,
  onOpenChange,
  userId,
  onVerificationComplete,
}: SimplePhotoVerificationProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [screen, setScreen] = useState<Screen>("intro");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setScreen("intro");
      setCapturedImage(null);
      setCapturedBlob(null);
      setCameraError(null);
    }
  }, [open]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = async () => {
    setCameraError(null);
    setScreen("camera");

    await new Promise((r) => setTimeout(r, 300));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (e) {
          console.warn("play() failed, autoPlay should handle it:", e);
        }
      }
    } catch (err: any) {
      console.error("Camera error:", err.name, err.message);
      if (err.name === "NotAllowedError") {
        setCameraError("Camera access denied. Please allow camera in your browser settings, then reload the page.");
      } else if (err.name === "NotFoundError") {
        setCameraError("No front camera found on this device.");
      } else {
        setCameraError("Could not access camera. Please try again.");
      }
      setScreen("error");
    }
  };

  const takeSelfie = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoRef.current, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImage(dataUrl);

    canvas.toBlob(
      (blob) => {
        setCapturedBlob(blob);
      },
      "image/jpeg",
      0.9
    );

    stopCamera();
    setScreen("preview");
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setCapturedBlob(null);
    startCamera();
  };

  const handleSubmit = async () => {
    if (!capturedBlob) return;
    setScreen("uploading");

    try {
      const fileName = `${userId}/${Date.now()}_verification.jpg`;

      // Try proof-selfies bucket first, fallback to profile-photos
      let uploadOk = false;
      const { error: uploadError } = await supabase.storage
        .from("proof-selfies")
        .upload(fileName, capturedBlob, { contentType: "image/jpeg", cacheControl: "3600" });

      if (uploadError) {
        console.warn("proof-selfies upload failed, trying profile-photos:", uploadError.message);
        const { error: fallbackError } = await supabase.storage
          .from("profile-photos")
          .upload(`${userId}/verification_${Date.now()}.jpg`, capturedBlob, {
            contentType: "image/jpeg",
            cacheControl: "3600",
          });
        if (fallbackError) throw fallbackError;
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          photo_verified: true,
          photo_verified_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (updateError) throw updateError;

      setScreen("success");
      toast.success("Photo verified! ✅");

      setTimeout(() => {
        onVerificationComplete(true);
        onOpenChange(false);
      }, 2000);
    } catch (err: any) {
      console.error("Verification upload failed:", err);
      setCameraError("Failed to upload selfie. Please try again.");
      setScreen("error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center gap-2 font-display">
            <Shield className="w-5 h-5 text-primary" />
            Photo Verification
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Take a quick selfie to verify your identity
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          {/* INTRO */}
          {screen === "intro" && (
            <div className="flex flex-col items-center gap-5 py-4">
              <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
                <Camera className="w-10 h-10 text-primary" />
              </div>

              <div className="text-center space-y-1">
                <p className="text-lg font-display font-semibold text-foreground">Quick selfie check</p>
                <p className="text-sm text-muted-foreground">
                  Take a selfie to prove you're really you. Verified profiles get 3× more matches!
                </p>
              </div>

              <div className="w-full rounded-xl bg-secondary/50 p-4 text-sm text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Tips for success:</p>
                <p>• Good lighting on your face</p>
                <p>• Look directly at the camera</p>
                <p>• Remove sunglasses or hats</p>
              </div>

              <Button variant="gradient" className="w-full" onClick={startCamera}>
                <Camera className="w-4 h-4 mr-2" />
                Open Camera
              </Button>
            </div>
          )}

          {/* CAMERA */}
          {screen === "camera" && (
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ transform: "scaleX(-1)" }}
                />
                {/* Face guide oval */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-64 rounded-[50%] border-2 border-primary/60 border-dashed" />
                </div>
                <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/80 drop-shadow-lg">
                  Position your face in the oval
                </p>
              </div>

              <Button variant="gradient" className="w-full" onClick={takeSelfie}>
                <Camera className="w-4 h-4 mr-2" />
                Take Selfie
              </Button>
            </div>
          )}

          {/* PREVIEW */}
          {screen === "preview" && capturedImage && (
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden">
                <img src={capturedImage} alt="Selfie preview" className="w-full h-full object-cover" />
              </div>

              <div className="flex gap-3 w-full">
                <Button variant="outline" className="flex-1" onClick={handleRetake}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Retake
                </Button>
                <Button variant="gradient" className="flex-1" onClick={handleSubmit}>
                  <Check className="w-4 h-4 mr-2" />
                  Submit
                </Button>
              </div>
            </div>
          )}

          {/* UPLOADING */}
          {screen === "uploading" && (
            <div className="flex flex-col items-center gap-4 py-12">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-foreground font-medium">Verifying...</p>
            </div>
          )}

          {/* SUCCESS */}
          {screen === "success" && (
            <div className="flex flex-col items-center gap-4 py-12">
              <div className="w-20 h-20 rounded-full bg-neon-cyan/20 flex items-center justify-center">
                <Check className="w-10 h-10 text-neon-cyan" />
              </div>
              <p className="text-lg font-display font-semibold text-foreground">You're Verified! ✅</p>
              <p className="text-sm text-muted-foreground">Your trust badge is now active.</p>
            </div>
          )}

          {/* ERROR */}
          {screen === "error" && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <AlertCircle className="w-12 h-12 text-destructive" />
              <p className="text-foreground font-medium">Something went wrong</p>
              <p className="text-sm text-muted-foreground">{cameraError}</p>
              <div className="flex gap-3 w-full">
                <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button variant="gradient" className="flex-1" onClick={startCamera}>
                  Try Again
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
