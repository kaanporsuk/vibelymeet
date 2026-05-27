import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  completeWebAuthReturnFromUrl,
  getPendingBrowserAuthReturnUrl,
} from "@/lib/webAuthReturn";
import {
  clearCapturedInitialAuthReturnUrl,
  scrubCurrentAuthReturnUrl,
} from "@/lib/webAuthReturnBootstrap";

export function WebAuthReturnHandler() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastHandledUrlRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const currentUrl = window.location.href;
    const pendingAuthReturnUrl = getPendingBrowserAuthReturnUrl(currentUrl);
    if (!pendingAuthReturnUrl) return;
    if (lastHandledUrlRef.current === pendingAuthReturnUrl) return;

    lastHandledUrlRef.current = pendingAuthReturnUrl;
    scrubCurrentAuthReturnUrl(pendingAuthReturnUrl);
    let cancelled = false;

    void (async () => {
      const result = await completeWebAuthReturnFromUrl(pendingAuthReturnUrl);
      if (cancelled || !result.handled) return;

      clearCapturedInitialAuthReturnUrl();

      if (result.error) {
        const params = new URLSearchParams();
        params.set("auth_error", result.error.message);
        navigate(`/auth?${params.toString()}`, { replace: true });
        return;
      }

      const currentPath = window.location.pathname;
      navigate(currentPath === "/auth" ? "/auth" : "/", { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search, location.hash, navigate]);

  return null;
}
