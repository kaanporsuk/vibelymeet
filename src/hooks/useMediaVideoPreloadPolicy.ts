import { useEffect, useState } from "react";
import { reserveMediaPrewarmBudgetForSource } from "@/lib/mediaPlaybackSessionPolicy";

const DEFAULT_METADATA_PREWARM_ESTIMATE_BYTES = 300 * 1024;

export function useMediaVideoPreloadForVisibility(
  isVisible: boolean,
  sourceUrl: string | null | undefined,
  bytesEstimate = DEFAULT_METADATA_PREWARM_ESTIMATE_BYTES,
): "metadata" | "none" {
  const [preload, setPreload] = useState<"metadata" | "none">("none");

  useEffect(() => {
    if (!isVisible || !sourceUrl) {
      setPreload("none");
      return;
    }
    setPreload(reserveMediaPrewarmBudgetForSource(sourceUrl, bytesEstimate) ? "metadata" : "none");
  }, [bytesEstimate, isVisible, sourceUrl]);

  return preload;
}
