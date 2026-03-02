import { useState, useRef, useCallback } from "react";
import * as faceapi from "face-api.js";

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model";
const MATCH_THRESHOLD = 0.5;

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

const POSE_CHALLENGES: Omit<PoseChallenge, "id" | "completed">[] = [
  { type: "look-straight", label: "Look Straight", instruction: "Look directly at the camera", icon: "👁️" },
  { type: "smile", label: "Smile", instruction: "Give us your best smile!", icon: "😊" },
  { type: "turn-left", label: "Turn Left", instruction: "Slowly turn your head left", icon: "👈" },
  { type: "turn-right", label: "Turn Right", instruction: "Slowly turn your head right", icon: "👉" },
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
  const [cameraReady, setCameraReady] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [forceShowCamera, setForceShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelsLoaded = useRef(false);
  const blinkHistory = useRef<boolean[]>([]);
  const poseHoldTimer = useRef<NodeJS.Timeout | null>(null);
  const faceSamplesRef = useRef<Float32Array[]>([]);

  const initializeChallenges = useCallback(() => {
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

  const loadModels = useCallback(async (): Promise<boolean> => {
    if (modelsLoaded.current) {
      setModelsReady(true);
      return true;
    }
    
    try {
      console.log("Loading face detection models from:", MODEL_URL);
      
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      setProgress(20);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      setProgress(40);
      await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
      setProgress(60);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      setProgress(80);
      
      await new Promise(resolve => setTimeout(resolve, 300));
      setProgress(100);
      
      modelsLoaded.current = true;
      setModelsReady(true);
      console.log("Face detection models loaded successfully");
      return true;
    } catch (error) {
      console.error("Failed to load face-api models:", error);
      setModelsReady(false);
      return false;
    }
  }, []);

  const startCamera = useCallback(async (videoElement: HTMLVideoElement, retries = 3): Promise<boolean> => {
    setCameraError(null);
    
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`Camera attempt ${i + 1}/${retries}`);
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
        
        // Safari sometimes needs explicit play()
        try {
          await videoElement.play();
        } catch (playError) {
          console.warn("Video play() failed:", playError);
        }
        
        console.log("Camera stream obtained:", stream.getVideoTracks()[0]?.getSettings());
        setCameraReady(true);
        return true;
      } catch (error: any) {
        console.error(`Camera attempt ${i + 1} failed:`, error.name, error.message);
        
        if (error.name === "NotAllowedError") {
          setCameraError("Camera access denied. Please allow camera in your browser settings and reload.");
          return false;
        }
        if (error.name === "NotFoundError") {
          setCameraError("No front camera found on this device.");
          return false;
        }
        
        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    
    setCameraError("Could not access camera after multiple attempts.");
    return false;
  }, []);

  // Camera-first initialization: start camera immediately, load models in parallel
  const initializeAll = useCallback(async (videoElement: HTMLVideoElement) => {
    setCameraError(null);
    setForceShowCamera(false);
    setCameraReady(false);
    setModelsReady(false);
    setStatus("loading-models");
    setProgress(0);
    
    // Step 1: Start camera FIRST
    const cameraOk = await startCamera(videoElement);
    if (!cameraOk) {
      setStatus("error");
      setErrorMessage(cameraError || "Could not access camera.");
      return;
    }
    
    // Camera is now visible, set capturing
    setStatus("capturing");
    
    // Step 2: Load models IN PARALLEL (camera already visible)
    const modelsOk = await loadModels();
    
    if (modelsOk) {
      initializeChallenges();
      // Status stays "capturing" — user sees camera + face detection starts
    } else {
      console.warn("Models failed — will force camera visible after timeout");
      // forceShowCamera will be set by a timeout in the component
    }
  }, [startCamera, loadModels, initializeChallenges, cameraError]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log("Stopped track:", track.kind);
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (poseHoldTimer.current) {
      clearTimeout(poseHoldTimer.current);
    }
    setCameraReady(false);
    setFaceDetected(false);
    setFaceAnalysis(null);
  }, []);

  const analyzeFace = useCallback(async (): Promise<FaceAnalysis | null> => {
    if (!videoRef.current) return null;
    
    // Check video readyState
    if (videoRef.current.readyState < 2) return null;
    if (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) return null;
    
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
      
      const nose = landmarks.getNose();
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      
      const eyeCenter = {
        x: (leftEye[0].x + rightEye[3].x) / 2,
        y: (leftEye[0].y + rightEye[3].y) / 2,
      };
      const noseTop = nose[0];
      const noseBottom = nose[6];
      
      const eyeDistance = rightEye[3].x - leftEye[0].x;
      const noseOffset = ((noseTop.x + noseBottom.x) / 2 - eyeCenter.x) / eyeDistance;
      const yaw = noseOffset * 50;
      
      const eyeToNose = noseBottom.y - eyeCenter.y;
      const pitch = (eyeToNose / eyeDistance - 0.8) * 30;
      
      const eyeSlope = (rightEye[3].y - leftEye[0].y) / eyeDistance;
      const roll = Math.atan(eyeSlope) * (180 / Math.PI);
      
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
        eyesOpen: { left: leftEAR > 0.2, right: rightEAR > 0.2 },
        faceBox: {
          x: detection.detection.box.x,
          y: detection.detection.box.y,
          width: detection.detection.box.width,
          height: detection.detection.box.height,
        },
      };
      
      const eyesClosed = !analysis.eyesOpen.left && !analysis.eyesOpen.right;
      blinkHistory.current.push(eyesClosed);
      if (blinkHistory.current.length > 30) blinkHistory.current.shift();
      
      setFaceAnalysis(analysis);
      return analysis;
    } catch (error) {
      console.error("Face analysis error:", error);
      return null;
    }
  }, []);

  const checkPoseChallenge = useCallback((analysis: FaceAnalysis): boolean => {
    if (challenges.length === 0 || currentChallengeIndex >= challenges.length) return false;
    
    const currentChallenge = challenges[currentChallengeIndex];
    
    switch (currentChallenge.type) {
      case "look-straight":
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
        const history = blinkHistory.current;
        if (history.length < 10) return false;
        return history.slice(-10).some((closed, i, arr) => 
          closed && i > 0 && !arr[i-1] && i < arr.length - 1 && !arr[i+1]
        );
      case "nod":
        return Math.abs(analysis.headPose.pitch) > 15;
      default:
        return false;
    }
  }, [challenges, currentChallengeIndex]);

  const startPoseChallenge = useCallback(() => {
    setStatus("pose-challenge");
    initializeChallenges();
    setLivenessScore(0);
    faceSamplesRef.current = [];
  }, [initializeChallenges]);

  const captureFaceSample = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (detection) faceSamplesRef.current.push(detection.descriptor);
    } catch (error) {
      console.error("Error capturing face sample:", error);
    }
  }, []);

  const processPoseChallenge = useCallback(async (): Promise<boolean> => {
    const analysis = await analyzeFace();
    if (!analysis) {
      setChallengeProgress(0);
      return false;
    }
    
    const isPoseCorrect = checkPoseChallenge(analysis);
    
    if (isPoseCorrect) {
      setChallengeProgress(prev => {
        const newProgress = Math.min(prev + 5, 100);
        if (newProgress >= 100) {
          const updatedChallenges = [...challenges];
          updatedChallenges[currentChallengeIndex].completed = true;
          setChallenges(updatedChallenges);
          setLivenessScore(prev => prev + 33);
          captureFaceSample();
          if (currentChallengeIndex < challenges.length - 1) {
            setCurrentChallengeIndex(prev => prev + 1);
            return 0;
          }
          return 100;
        }
        return newProgress;
      });
      return true;
    } else {
      setChallengeProgress(prev => Math.max(prev - 10, 0));
      return false;
    }
  }, [analyzeFace, checkPoseChallenge, challenges, currentChallengeIndex, captureFaceSample]);

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
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoRef.current, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.9);
    });
  }, []);

  // Manual selfie capture fallback when models fail
  const captureManualSelfie = useCallback(async (): Promise<Blob | null> => {
    if (!videoRef.current) return null;
    const blob = await captureSelfie();
    return blob;
  }, [captureSelfie]);

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
      const selfieDescriptor = await getFaceDescriptor(videoRef.current);
      if (!selfieDescriptor) {
        setStatus("failed");
        return { success: false, message: "No face detected in selfie. Please ensure your face is clearly visible." };
      }
      
      const selfieBlob = await captureSelfie();
      const profileImage = await loadImageFromUrl(profilePhotoUrl);
      const profileDescriptor = await getFaceDescriptor(profileImage);
      
      if (!profileDescriptor) {
        setStatus("failed");
        return { success: false, message: "No face detected in profile photo. Please update your main photo with a clear face shot." };
      }
      
      const distance = faceapi.euclideanDistance(selfieDescriptor, profileDescriptor);
      
      let avgSampleDistance = 0;
      if (faceSamplesRef.current.length > 0) {
        const sampleDistances = faceSamplesRef.current.map(sample => 
          faceapi.euclideanDistance(sample, profileDescriptor)
        );
        avgSampleDistance = sampleDistances.reduce((a, b) => a + b, 0) / sampleDistances.length;
      }
      
      const finalDistance = faceSamplesRef.current.length > 0 
        ? (distance + avgSampleDistance) / 2 
        : distance;
      
      const isMatch = finalDistance < MATCH_THRESHOLD;
      const confidenceScore = Math.max(0, Math.min(100, Math.round((1 - finalDistance) * 100)));
      
      if (isMatch && livenessScore >= 66) {
        setStatus("success");
        return { success: true, distance: finalDistance, message: "Verification successful!", selfieBlob: selfieBlob || undefined, confidenceScore };
      } else if (!isMatch) {
        setStatus("failed");
        return { success: false, distance: finalDistance, message: "Face doesn't match your profile photo.", confidenceScore };
      } else {
        setStatus("failed");
        return { success: false, message: "Liveness check incomplete. Please complete all pose challenges.", confidenceScore };
      }
    } catch (error) {
      console.error("Verification error:", error);
      setStatus("error");
      setErrorMessage("Verification failed. Please try again.");
      return { success: false, message: "An error occurred during verification." };
    }
  }, [getFaceDescriptor, loadImageFromUrl, captureSelfie, livenessScore]);

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
    setCameraReady(false);
    setModelsReady(false);
    setForceShowCamera(false);
    setCameraError(null);
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
    cameraReady,
    modelsReady,
    forceShowCamera,
    setForceShowCamera,
    cameraError,
    setCameraError,
    loadModels,
    startCamera,
    stopCamera,
    initializeAll,
    analyzeFace,
    detectFaceInVideo,
    startPoseChallenge,
    processPoseChallenge,
    captureManualSelfie,
    verifyAgainstProfilePhoto,
    reset,
  };
};
