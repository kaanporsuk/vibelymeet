declare module "canvas-confetti" {
  type ConfettiOptions = {
    angle?: number;
    colors?: string[];
    decay?: number;
    disableForReducedMotion?: boolean;
    drift?: number;
    gravity?: number;
    origin?: { x?: number; y?: number };
    particleCount?: number;
    scalar?: number;
    shapes?: string[];
    spread?: number;
    startVelocity?: number;
    ticks?: number;
    zIndex?: number;
  };

  type ConfettiInstance = {
    (options?: ConfettiOptions): Promise<null> | null;
    reset: () => void;
  };

  const confetti: ConfettiInstance & {
    create: (
      canvas: HTMLCanvasElement,
      options?: {
        disableForReducedMotion?: boolean;
        resize?: boolean;
        useWorker?: boolean;
      },
    ) => ConfettiInstance;
    reset: () => void;
  };

  export default confetti;
}
