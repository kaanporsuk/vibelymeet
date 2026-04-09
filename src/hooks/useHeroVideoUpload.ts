import { useEffect, useState } from "react";
import {
  heroVideoGetState,
  heroVideoSubscribe,
  type HeroVideoControllerState,
} from "@/lib/heroVideo/heroVideoUploadController";

/**
 * Subscribe to the hero video upload controller.
 * Returns live controller state that updates whenever phase/progress changes.
 * Works across component mounts/unmounts — the underlying controller persists.
 */
export function useHeroVideoUpload(): HeroVideoControllerState {
  const [state, setState] = useState<HeroVideoControllerState>(heroVideoGetState);

  useEffect(() => {
    // Sync once on mount in case state changed between render and effect
    setState(heroVideoGetState());
    return heroVideoSubscribe(setState);
  }, []);

  return state;
}
