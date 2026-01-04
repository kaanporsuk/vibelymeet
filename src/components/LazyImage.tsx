import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  placeholderColor?: string;
  blurDataURL?: string;
  onClick?: () => void;
  onLoad?: () => void;
  aspectRatio?: string;
}

export const LazyImage = ({
  src,
  alt,
  className,
  placeholderColor = "hsl(var(--muted))",
  blurDataURL,
  onClick,
  onLoad,
  aspectRatio,
}: LazyImageProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  // Use Intersection Observer for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: "200px", // Start loading 200px before entering viewport
        threshold: 0,
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Generate a low-quality placeholder from the image URL
  const generatePlaceholder = (url: string) => {
    // If we have a Supabase storage URL, we can request a smaller version
    if (url.includes("supabase")) {
      // Add transform parameters for a tiny blurred placeholder
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}width=20&quality=10`;
    }
    return blurDataURL;
  };

  const placeholderUrl = generatePlaceholder(src);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    setHasError(true);
  };

  return (
    <div
      ref={imgRef}
      className={cn("relative overflow-hidden bg-muted", className)}
      style={{ 
        backgroundColor: placeholderColor,
        aspectRatio: aspectRatio,
      }}
      onClick={onClick}
    >
      {/* Blur placeholder - shows immediately */}
      {placeholderUrl && !hasError && (
        <motion.img
          src={placeholderUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            filter: "blur(20px)",
            transform: "scale(1.1)", // Prevent blur edge artifacts
          }}
          initial={{ opacity: 1 }}
          animate={{ opacity: isLoaded ? 0 : 1 }}
          transition={{ duration: 0.3 }}
        />
      )}

      {/* Shimmer effect while loading */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 shimmer-effect" />
      )}

      {/* Actual image - only loads when in view */}
      {isInView && !hasError && (
        <motion.img
          src={src}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover"
          onLoad={handleLoad}
          onError={handleError}
          initial={{ opacity: 0 }}
          animate={{ opacity: isLoaded ? 1 : 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <div className="text-center text-muted-foreground p-4">
            <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-muted-foreground/20 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <span className="text-xs">Failed to load</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Lazy video component with similar functionality
interface LazyVideoProps {
  src: string;
  poster?: string;
  className?: string;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  controls?: boolean;
  playsInline?: boolean;
  onClick?: () => void;
}

export const LazyVideo = ({
  src,
  poster,
  className,
  autoPlay = false,
  loop = false,
  muted = true,
  controls = false,
  playsInline = true,
  onClick,
}: LazyVideoProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [hasError, setHasError] = useState(false);
  const videoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: "100px",
        threshold: 0,
      }
    );

    if (videoRef.current) {
      observer.observe(videoRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={videoRef}
      className={cn("relative overflow-hidden bg-muted", className)}
      onClick={onClick}
    >
      {/* Poster as placeholder */}
      {poster && !isLoaded && !hasError && (
        <motion.img
          src={poster}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            filter: isLoaded ? "none" : "blur(10px)",
          }}
          initial={{ opacity: 1 }}
          animate={{ opacity: isLoaded ? 0 : 1 }}
          transition={{ duration: 0.3 }}
        />
      )}

      {/* Shimmer while loading */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 shimmer-effect" />
      )}

      {/* Actual video */}
      {isInView && !hasError && (
        <motion.video
          src={src}
          poster={poster}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay={autoPlay}
          loop={loop}
          muted={muted}
          controls={controls}
          playsInline={playsInline}
          onLoadedData={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
          initial={{ opacity: 0 }}
          animate={{ opacity: isLoaded ? 1 : 0 }}
          transition={{ duration: 0.4 }}
        />
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <div className="text-center text-muted-foreground p-4">
            <span className="text-xs">Video unavailable</span>
          </div>
        </div>
      )}
    </div>
  );
};
