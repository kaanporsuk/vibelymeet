import { useState, useRef, useCallback } from "react";
import * as faceapi from "face-api.js";

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model";
const MATCH_THRESHOLD = 0.5; // Lower is more strict (0.0 = identical, 1.0 = different)

export type VerificationStatus = 
  | "idle"
  | "loading-models"
  | "ready"
  | "capturing"
  | "processing"
  | "success"
  | "failed"
  | "error";

export interface VerificationResult {
  success: boolean;
  distance?: number;
  message: string;
  selfieBlob?: Blob;
}

export const useFaceVerification = () => {
  const [status, setStatus] = useState<VerificationStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelsLoaded = useRef(false);

  const loadModels = useCallback(async () => {
    if (modelsLoaded.current) return true;
    
    setStatus("loading-models");
    setProgress(0);
    
    try {
      // Load required models for face detection and recognition
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      setProgress(33);
      
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      setProgress(66);
      
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      setProgress(100);
      
      modelsLoaded.current = true;
      setStatus("ready");
      return true;
    } catch (error) {
      console.error("Failed to load face-api models:", error);
      setStatus("error");
      setErrorMessage("Failed to load face detection models. Please try again.");
      return false;
    }
  }, []);

  const startCamera = useCallback(async (videoElement: HTMLVideoElement) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
      });
      
      videoElement.srcObject = stream;
      videoRef.current = videoElement;
      streamRef.current = stream;
      
      await videoElement.play();
      setStatus("capturing");
      return true;
    } catch (error) {
      console.error("Camera access error:", error);
      setStatus("error");
      setErrorMessage("Could not access camera. Please grant permission and try again.");
      return false;
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setFaceDetected(false);
  }, []);

  const detectFaceInVideo = useCallback(async (): Promise<boolean> => {
    if (!videoRef.current) return false;
    
    const detection = await faceapi.detectSingleFace(
      videoRef.current,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
    );
    
    const detected = !!detection;
    setFaceDetected(detected);
    return detected;
  }, []);

  const captureSelfie = useCallback(async (): Promise<Blob | null> => {
    if (!videoRef.current) return null;
    
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    
    // Flip horizontally for mirror effect
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoRef.current, 0, 0);
    
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.9);
    });
  }, []);

  const getFaceDescriptor = useCallback(async (
    input: HTMLVideoElement | HTMLImageElement
  ): Promise<Float32Array | null> => {
    const detection = await faceapi
      .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    
    if (!detection) return null;
    return detection.descriptor;
  }, []);

  const loadImageFromUrl = useCallback(async (url: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }, []);

  const verifyAgainstProfilePhoto = useCallback(async (
    profilePhotoUrl: string
  ): Promise<VerificationResult> => {
    if (!videoRef.current) {
      return { success: false, message: "Camera not initialized" };
    }
    
    setStatus("processing");
    setErrorMessage(null);
    
    try {
      // Get descriptor from live video
      const selfieDescriptor = await getFaceDescriptor(videoRef.current);
      if (!selfieDescriptor) {
        setStatus("failed");
        return { 
          success: false, 
          message: "No face detected in selfie. Please ensure your face is clearly visible." 
        };
      }
      
      // Capture the selfie blob before stopping camera
      const selfieBlob = await captureSelfie();
      
      // Load and analyze profile photo
      const profileImage = await loadImageFromUrl(profilePhotoUrl);
      const profileDescriptor = await getFaceDescriptor(profileImage);
      
      if (!profileDescriptor) {
        setStatus("failed");
        return { 
          success: false, 
          message: "No face detected in profile photo. Please update your main photo with a clear face shot." 
        };
      }
      
      // Compare face descriptors using Euclidean distance
      const distance = faceapi.euclideanDistance(selfieDescriptor, profileDescriptor);
      const isMatch = distance < MATCH_THRESHOLD;
      
      if (isMatch) {
        setStatus("success");
        return {
          success: true,
          distance,
          message: "Verification successful! Your identity has been confirmed.",
          selfieBlob: selfieBlob || undefined,
        };
      } else {
        setStatus("failed");
        return {
          success: false,
          distance,
          message: "Face doesn't match your profile photo. Please try again with better lighting.",
        };
      }
    } catch (error) {
      console.error("Verification error:", error);
      setStatus("error");
      setErrorMessage("Verification failed. Please try again.");
      return { success: false, message: "An error occurred during verification." };
    }
  }, [getFaceDescriptor, loadImageFromUrl, captureSelfie]);

  const reset = useCallback(() => {
    stopCamera();
    setStatus("idle");
    setProgress(0);
    setErrorMessage(null);
    setFaceDetected(false);
  }, [stopCamera]);

  return {
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
  };
};
