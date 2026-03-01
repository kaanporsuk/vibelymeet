import { useState, useRef, useCallback } from "react";
import * as faceapi from "face-api.js";

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model";
const MATCH_THRESHOLD = 0.5; // Lower is more strict (0.0 = identical, 1.0 = different)

export type VerificationStatus = 
  | "idle"
  | "loading-models"
  | "ready"
  | "capturing"
  | "pose-challenge"
  | "processing"
  | "success"
  | "failed"
  | "error";

export type PoseType = 
  | "look-straight"
  | "smile"
  | "turn-left"
  | "turn-right"
  | "blink"
  | "nod";

export interface PoseChallenge {
  id: string;
  type: PoseType;
  label: string;
  instruction: string;
  icon: string;
  completed: boolean;
}

export interface FaceAnalysis {
  hasFace: boolean;
  isSmiling: boolean;
  headPose: {
    roll: number;
    pitch: number;
    yaw: number;
  };
  eyesOpen: {
    left: boolean;
    right: boolean;
  };
  faceBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export interface VerificationResult {
  success: boolean;
  distance?: number;
  message: string;
  selfieBlob?: Blob;
  confidenceScore?: number;
}

// Pose challenges that users must complete (like Bumble/Tinder)
const POSE_CHALLENGES: Omit<PoseChallenge, "id" | "completed">[] = [
  {
    type: "look-straight",
    label: "Look Straight",
    instruction: "Look directly at the camera",
    icon: "👁️",
  },
  {
    type: "smile",
    label: "Smile",
    instruction: "Give us your best smile!",
    icon: "😊",
  },
  {
    type: "turn-left",
    label: "Turn Left",
    instruction: "Slowly turn your head left",
    icon: "👈",
  },
  {
    type: "turn-right",
    label: "Turn Right",
    instruction: "Slowly turn your head right",
    icon: "👉",
  },
];

export const useFaceVerification = () => {
  const [status, setStatus] = useState<VerificationStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [faceAnalysis, setFaceAnalysis] = useState<FaceAnalysis | null>(null);
  const [challenges, setChallenges] = useState<PoseChallenge[]>([]);
  const [currentChallengeIndex, setCurrentChallengeIndex] = useState(0);
  const [challengeProgress, setChallengeProgress] = useState(0);
  const [livenessScore, setLivenessScore] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelsLoaded = useRef(false);
  const blinkHistory = useRef<boolean[]>([]);
  const poseHoldTimer = useRef<NodeJS.Timeout | null>(null);
  const faceSamplesRef = useRef<Float32Array[]>([]);

  // Initialize random pose challenges
  const initializeChallenges = useCallback(() => {
    // Shuffle and pick 3 challenges
    const shuffled = [...POSE_CHALLENGES].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 3).map((c, i) => ({
      ...c,
      id: `challenge-${i}`,
      completed: false,
    }));
    setChallenges(selected);
    setCurrentChallengeIndex(0);
    setChallengeProgress(0);
  }, []);

  const loadModels = useCallback(async () => {
    if (modelsLoaded.current) return true;
    
    setStatus("loading-models");
    setProgress(0);
    
    try {
      // Load required models for face detection, landmarks, expressions, and recognition
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      setProgress(20);
      
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      setProgress(40);
      
      await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
      setProgress(60);
      
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      setProgress(80);
      
      // Short delay for smoother UX
      await new Promise(resolve => setTimeout(resolve, 300));
      setProgress(100);
      
      modelsLoaded.current = true;
      initializeChallenges();
      setStatus("ready");
      return true;
    } catch (error) {
      console.error("Failed to load face-api models:", error);
      setStatus("error");
      setErrorMessage("Failed to load face detection models. Please try again.");
      return false;
    }
  }, [initializeChallenges]);

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
    } catch (error: any) {
      console.error("Camera access error:", error);
      setStatus("error");
      if (error?.name === "NotAllowedError") {
        setErrorMessage("Camera access denied. Please allow camera in your browser settings.");
      } else if (error?.name === "NotFoundError") {
        setErrorMessage("No camera found on this device.");
      } else {
        setErrorMessage("Could not access camera. Please try again.");
      }
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
    if (poseHoldTimer.current) {
      clearTimeout(poseHoldTimer.current);
    }
    setFaceDetected(false);
    setFaceAnalysis(null);
  }, []);

  // Advanced face analysis with expressions and pose
  const analyzeFace = useCallback(async (): Promise<FaceAnalysis | null> => {
    if (!videoRef.current) return null;
    
    try {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ 
          inputSize: 320, 
          scoreThreshold: 0.5 
        }))
        .withFaceLandmarks()
        .withFaceExpressions();
      
      if (!detection) {
        setFaceDetected(false);
        return null;
      }

      setFaceDetected(true);
      
      const landmarks = detection.landmarks;
      const expressions = detection.expressions;
      
      // Calculate head pose from landmarks
      const nose = landmarks.getNose();
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      
      // Simplified head pose estimation
      const eyeCenter = {
        x: (leftEye[0].x + rightEye[3].x) / 2,
        y: (leftEye[0].y + rightEye[3].y) / 2,
      };
      const noseTop = nose[0];
      const noseBottom = nose[6];
      
      // Yaw estimation (left/right turn)
      const eyeDistance = rightEye[3].x - leftEye[0].x;
      const noseOffset = ((noseTop.x + noseBottom.x) / 2 - eyeCenter.x) / eyeDistance;
      const yaw = noseOffset * 50; // Rough degrees
      
      // Pitch estimation (up/down)
      const eyeToNose = noseBottom.y - eyeCenter.y;
      const pitch = (eyeToNose / eyeDistance - 0.8) * 30;
      
      // Roll estimation (head tilt)
      const eyeSlope = (rightEye[3].y - leftEye[0].y) / eyeDistance;
      const roll = Math.atan(eyeSlope) * (180 / Math.PI);
      
      // Eye open detection (EAR - Eye Aspect Ratio)
      const getEAR = (eye: faceapi.Point[]) => {
        const vertical1 = Math.hypot(eye[1].x - eye[5].x, eye[1].y - eye[5].y);
        const vertical2 = Math.hypot(eye[2].x - eye[4].x, eye[2].y - eye[4].y);
        const horizontal = Math.hypot(eye[0].x - eye[3].x, eye[0].y - eye[3].y);
        return (vertical1 + vertical2) / (2 * horizontal);
      };
      
      const leftEAR = getEAR(leftEye);
      const rightEAR = getEAR(rightEye);
      
      const analysis: FaceAnalysis = {
        hasFace: true,
        isSmiling: expressions.happy > 0.7,
        headPose: { roll, pitch, yaw },
        eyesOpen: {
          left: leftEAR > 0.2,
          right: rightEAR > 0.2,
        },
        faceBox: {
          x: detection.detection.box.x,
          y: detection.detection.box.y,
          width: detection.detection.box.width,
          height: detection.detection.box.height,
        },
      };
      
      // Track blink history for liveness
      const eyesClosed = !analysis.eyesOpen.left && !analysis.eyesOpen.right;
      blinkHistory.current.push(eyesClosed);
      if (blinkHistory.current.length > 30) {
        blinkHistory.current.shift();
      }
      
      setFaceAnalysis(analysis);
      return analysis;
    } catch (error) {
      console.error("Face analysis error:", error);
      return null;
    }
  }, []);

  // Check if current pose challenge is completed
  const checkPoseChallenge = useCallback((analysis: FaceAnalysis): boolean => {
    if (challenges.length === 0 || currentChallengeIndex >= challenges.length) {
      return false;
    }
    
    const currentChallenge = challenges[currentChallengeIndex];
    
    switch (currentChallenge.type) {
      case "look-straight":
        // Face should be centered and looking straight
        return Math.abs(analysis.headPose.yaw) < 10 && 
               Math.abs(analysis.headPose.pitch) < 15 &&
               Math.abs(analysis.headPose.roll) < 10;
        
      case "smile":
        return analysis.isSmiling;
        
      case "turn-left":
        return analysis.headPose.yaw > 20;
        
      case "turn-right":
        return analysis.headPose.yaw < -20;
        
      case "blink":
        // Check for recent blink in history
        const history = blinkHistory.current;
        if (history.length < 10) return false;
        // Look for a closed-open pattern
        const recentBlink = history.slice(-10).some((closed, i, arr) => 
          closed && i > 0 && !arr[i-1] && i < arr.length - 1 && !arr[i+1]
        );
        return recentBlink;
        
      case "nod":
        // Would need pitch tracking over time - simplified for now
        return Math.abs(analysis.headPose.pitch) > 15;
        
      default:
        return false;
    }
  }, [challenges, currentChallengeIndex]);

  // Start pose challenge mode
  const startPoseChallenge = useCallback(() => {
    setStatus("pose-challenge");
    initializeChallenges();
    setLivenessScore(0);
    faceSamplesRef.current = [];
  }, [initializeChallenges]);

  // Process pose detection during challenge
  const processPoseChallenge = useCallback(async (): Promise<boolean> => {
    const analysis = await analyzeFace();
    if (!analysis) {
      setChallengeProgress(0);
      return false;
    }
    
    const isPoseCorrect = checkPoseChallenge(analysis);
    
    if (isPoseCorrect) {
      // Increment progress when pose is held
      setChallengeProgress(prev => {
        const newProgress = Math.min(prev + 5, 100);
        
        // Pose held long enough - complete this challenge
        if (newProgress >= 100) {
          const updatedChallenges = [...challenges];
          updatedChallenges[currentChallengeIndex].completed = true;
          setChallenges(updatedChallenges);
          
          // Increase liveness score
          setLivenessScore(prev => prev + 33);
          
          // Capture a face sample for later matching
          captureFaceSample();
          
          // Move to next challenge or complete
          if (currentChallengeIndex < challenges.length - 1) {
            setCurrentChallengeIndex(prev => prev + 1);
            return 0; // Reset progress for next challenge
          }
          
          return 100;
        }
        
        return newProgress;
      });
      return true;
    } else {
      // Reset progress if pose is lost
      setChallengeProgress(prev => Math.max(prev - 10, 0));
      return false;
    }
  }, [analyzeFace, checkPoseChallenge, challenges, currentChallengeIndex]);

  // Capture face descriptor sample during challenge
  const captureFaceSample = useCallback(async () => {
    if (!videoRef.current) return;
    
    try {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ 
          inputSize: 416, 
          scoreThreshold: 0.5 
        }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      
      if (detection) {
        faceSamplesRef.current.push(detection.descriptor);
      }
    } catch (error) {
      console.error("Error capturing face sample:", error);
    }
  }, []);

  const detectFaceInVideo = useCallback(async (): Promise<boolean> => {
    const analysis = await analyzeFace();
    return analysis?.hasFace ?? false;
  }, [analyzeFace]);

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

  // Complete verification with liveness + face matching
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
      
      // Also compare against samples collected during pose challenges
      let avgSampleDistance = 0;
      if (faceSamplesRef.current.length > 0) {
        const sampleDistances = faceSamplesRef.current.map(sample => 
          faceapi.euclideanDistance(sample, profileDescriptor)
        );
        avgSampleDistance = sampleDistances.reduce((a, b) => a + b, 0) / sampleDistances.length;
      }
      
      // Use both current and sample-based matching
      const finalDistance = faceSamplesRef.current.length > 0 
        ? (distance + avgSampleDistance) / 2 
        : distance;
      
      const isMatch = finalDistance < MATCH_THRESHOLD;
      
      // Calculate confidence score
      const confidenceScore = Math.max(0, Math.min(100, Math.round((1 - finalDistance) * 100)));
      
      if (isMatch && livenessScore >= 66) {
        setStatus("success");
        return {
          success: true,
          distance: finalDistance,
          message: "Verification successful! Your identity has been confirmed.",
          selfieBlob: selfieBlob || undefined,
          confidenceScore,
        };
      } else if (!isMatch) {
        setStatus("failed");
        return {
          success: false,
          distance: finalDistance,
          message: "Face doesn't match your profile photo. Please try again with better lighting.",
          confidenceScore,
        };
      } else {
        setStatus("failed");
        return {
          success: false,
          message: "Liveness check incomplete. Please complete all pose challenges.",
          confidenceScore,
        };
      }
    } catch (error) {
      console.error("Verification error:", error);
      setStatus("error");
      setErrorMessage("Verification failed. Please try again.");
      return { success: false, message: "An error occurred during verification." };
    }
  }, [getFaceDescriptor, loadImageFromUrl, captureSelfie, livenessScore]);

  // Check if all challenges are completed
  const allChallengesCompleted = challenges.length > 0 && challenges.every(c => c.completed);

  const reset = useCallback(() => {
    stopCamera();
    setStatus("idle");
    setProgress(0);
    setErrorMessage(null);
    setFaceDetected(false);
    setFaceAnalysis(null);
    setChallenges([]);
    setCurrentChallengeIndex(0);
    setChallengeProgress(0);
    setLivenessScore(0);
    blinkHistory.current = [];
    faceSamplesRef.current = [];
  }, [stopCamera]);

  return {
    status,
    progress,
    errorMessage,
    faceDetected,
    faceAnalysis,
    challenges,
    currentChallengeIndex,
    currentChallenge: challenges[currentChallengeIndex] || null,
    challengeProgress,
    livenessScore,
    allChallengesCompleted,
    loadModels,
    startCamera,
    stopCamera,
    analyzeFace,
    detectFaceInVideo,
    startPoseChallenge,
    processPoseChallenge,
    verifyAgainstProfilePhoto,
    reset,
  };
};
