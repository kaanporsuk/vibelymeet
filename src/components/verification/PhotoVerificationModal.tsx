import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Camera, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  AlertTriangle,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFaceVerification, VerificationStatus } from "@/hooks/useFaceVerification";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PhotoVerificationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profilePhotoUrl: string;
  userId: string;
  onVerificationComplete: (success: boolean) => void;
}

export const PhotoVerificationModal = ({
  open,
  onOpenChange,
  profilePhotoUrl,
  userId,
  onVerificationComplete,
}: PhotoVerificationModalProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const faceCheckInterval = useRef<NodeJS.Timeout | null>(null);
  
  const {
    status,
    progress,
    errorMessage,
    faceDetected,
    loadModels,
    startCamera,
    stopCamera,
    detectFaceInVideo,
    verifyAgainstProfilePhoto,
    reset,
  } = useFaceVerification();

  const [isUploading, setIsUploading] = useState(false);

  // Initialize when modal opens
  useEffect(() => {
    if (open) {
      initializeVerification();
    } else {
      cleanup();
    }
    
    return () => cleanup();
  }, [open]);

  // Face detection loop when capturing
  useEffect(() => {
    if (status === "capturing" && videoRef.current) {
      faceCheckInterval.current = setInterval(() => {
        detectFaceInVideo();
      }, 500);
    } else {
      if (faceCheckInterval.current) {
        clearInterval(faceCheckInterval.current);
        faceCheckInterval.current = null;
      }
    }
    
    return () => {
      if (faceCheckInterval.current) {
        clearInterval(faceCheckInterval.current);
      }
    };
  }, [status, detectFaceInVideo]);

  const initializeVerification = async () => {
    const modelsReady = await loadModels();
    if (modelsReady && videoRef.current) {
      await startCamera(videoRef.current);
    }
  };

  const cleanup = () => {
    if (faceCheckInterval.current) {
      clearInterval(faceCheckInterval.current);
    }
    stopCamera();
    reset();
  };

  const handleVerify = async () => {
    if (!profilePhotoUrl) {
      toast.error("No profile photo found. Please add a photo first.");
      return;
    }

    const result = await verifyAgainstProfilePhoto(profilePhotoUrl);
    
    if (result.success && result.selfieBlob) {
      // Upload proof selfie to private bucket
      setIsUploading(true);
      try {
        const fileName = `${userId}/${Date.now()}_proof.jpg`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("proof-selfies")
          .upload(fileName, result.selfieBlob, {
            contentType: "image/jpeg",
            cacheControl: "3600",
          });

        if (uploadError) throw uploadError;

        // Get the URL (signed URL for private bucket)
        const { data: urlData } = await supabase.storage
          .from("proof-selfies")
          .createSignedUrl(uploadData.path, 60 * 60 * 24 * 365); // 1 year

        // Update profile with verification status
        const { error: updateError } = await supabase
          .from("profiles")
          .update({
            photo_verified: true,
            photo_verified_at: new Date().toISOString(),
            proof_selfie_url: urlData?.signedUrl || uploadData.path,
          })
          .eq("id", userId);

        if (updateError) throw updateError;

        toast.success("Photo verification complete!");
        onVerificationComplete(true);
      } catch (error) {
        console.error("Failed to save verification:", error);
        toast.error("Verification passed but failed to save. Please try again.");
      } finally {
        setIsUploading(false);
      }
    } else {
      onVerificationComplete(false);
    }
  };

  const handleRetry = () => {
    reset();
    initializeVerification();
  };

  const getStatusContent = () => {
    switch (status) {
      case "loading-models":
        return (
          <div className="text-center space-y-4">
            <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin" />
            <div className="space-y-2">
              <p className="font-medium text-foreground">Loading face detection...</p>
              <Progress value={progress} className="w-48 mx-auto" />
            </div>
          </div>
        );
      
      case "ready":
      case "capturing":
        return (
          <div className="space-y-4">
            {/* Camera preview with oval overlay */}
            <div className="relative aspect-[3/4] max-h-80 mx-auto rounded-2xl overflow-hidden bg-secondary">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              
              {/* Oval face guide */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div 
                  className={`w-48 h-64 rounded-[50%] border-4 transition-colors duration-300 ${
                    faceDetected 
                      ? "border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.5)]" 
                      : "border-white/60"
                  }`}
                />
              </div>
              
              {/* Face detection indicator */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                <div className={`px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-2 ${
                  faceDetected 
                    ? "bg-green-500/90 text-white" 
                    : "bg-black/60 text-white/80"
                }`}>
                  {faceDetected ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Face detected
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4" />
                      Position your face in the oval
                    </>
                  )}
                </div>
              </div>
            </div>
            
            <Button
              variant="gradient"
              size="lg"
              onClick={handleVerify}
              disabled={!faceDetected}
              className="w-full"
            >
              <ShieldCheck className="w-5 h-5 mr-2" />
              Verify My Identity
            </Button>
          </div>
        );
      
      case "processing":
        return (
          <div className="text-center space-y-4 py-8">
            <Loader2 className="w-16 h-16 mx-auto text-primary animate-spin" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Analyzing your face...</p>
              <p className="text-sm text-muted-foreground">Comparing with your profile photo</p>
            </div>
          </div>
        );
      
      case "success":
        return (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center space-y-4 py-8"
          >
            <div className="w-20 h-20 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
            </div>
            <div className="space-y-1">
              <p className="text-xl font-display font-bold text-foreground">Verified!</p>
              <p className="text-sm text-muted-foreground">
                {isUploading ? "Saving verification..." : "Your identity has been confirmed"}
              </p>
            </div>
            {isUploading && (
              <Loader2 className="w-6 h-6 mx-auto text-primary animate-spin" />
            )}
          </motion.div>
        );
      
      case "failed":
        return (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center space-y-4 py-6"
          >
            <div className="w-20 h-20 mx-auto rounded-full bg-destructive/20 flex items-center justify-center">
              <XCircle className="w-12 h-12 text-destructive" />
            </div>
            <div className="space-y-1">
              <p className="text-xl font-display font-bold text-foreground">Verification Failed</p>
              <p className="text-sm text-muted-foreground">
                Face doesn't match your profile photo
              </p>
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="gradient" onClick={handleRetry}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </div>
          </motion.div>
        );
      
      case "error":
        return (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center space-y-4 py-6"
          >
            <div className="w-20 h-20 mx-auto rounded-full bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="w-12 h-12 text-amber-500" />
            </div>
            <div className="space-y-1">
              <p className="text-xl font-display font-bold text-foreground">Something went wrong</p>
              <p className="text-sm text-muted-foreground">
                {errorMessage || "Please try again"}
              </p>
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="gradient" onClick={handleRetry}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </div>
          </motion.div>
        );
      
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Photo Verification
          </DialogTitle>
          <DialogDescription>
            Take a quick selfie to verify you match your profile photos
          </DialogDescription>
        </DialogHeader>
        
        <AnimatePresence mode="wait">
          <motion.div
            key={status}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {getStatusContent()}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};
