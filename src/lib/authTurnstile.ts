export const WEB_TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-explicit";
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type TurnstileSize = "normal" | "compact" | "flexible";

export type TurnstileRenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
  action?: string;
  size?: TurnstileSize;
};

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
      reset: (widgetId?: string) => void;
      remove?: (widgetId: string) => void;
    };
  }
}

export function webTurnstileEnabled(): boolean {
  return Boolean(WEB_TURNSTILE_SITE_KEY);
}

export function loadTurnstileScript(onReady: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  if (window.turnstile) {
    onReady();
    return () => {};
  }

  const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    existing.addEventListener("load", onReady, { once: true });
    return () => existing.removeEventListener("load", onReady);
  }

  const script = document.createElement("script");
  script.id = TURNSTILE_SCRIPT_ID;
  script.src = TURNSTILE_SCRIPT_SRC;
  script.async = true;
  script.defer = true;
  script.addEventListener("load", onReady, { once: true });
  document.head.appendChild(script);
  return () => script.removeEventListener("load", onReady);
}
