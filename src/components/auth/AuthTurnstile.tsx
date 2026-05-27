import { useEffect, useRef } from "react";
import {
  WEB_TURNSTILE_SITE_KEY,
  loadTurnstileScript,
  type TurnstileSize,
} from "@/lib/authTurnstile";

type AuthTurnstileProps = {
  action: string;
  className?: string;
  onTokenChange: (token: string) => void;
  resetSignal?: number;
  size?: TurnstileSize;
};

export function AuthTurnstile({
  action,
  className,
  onTokenChange,
  resetSignal = 0,
  size = "flexible",
}: AuthTurnstileProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const siteKey = WEB_TURNSTILE_SITE_KEY;
    if (!siteKey || !containerRef.current) return;

    let cancelled = false;
    const render = () => {
      if (cancelled || !window.turnstile || !containerRef.current || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        size,
        callback: onTokenChange,
        "expired-callback": () => onTokenChange(""),
        "error-callback": () => onTokenChange(""),
      });
    };

    const cleanupScriptListener = loadTurnstileScript(render);

    return () => {
      cancelled = true;
      cleanupScriptListener();
      if (widgetIdRef.current) {
        window.turnstile?.remove?.(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      onTokenChange("");
    };
  }, [action, onTokenChange, size]);

  useEffect(() => {
    if (!widgetIdRef.current) return;
    window.turnstile?.reset(widgetIdRef.current);
    onTokenChange("");
  }, [onTokenChange, resetSignal]);

  if (!WEB_TURNSTILE_SITE_KEY) return null;

  return (
    <div className={className}>
      <div ref={containerRef} className="min-h-[65px] w-full" />
    </div>
  );
}
