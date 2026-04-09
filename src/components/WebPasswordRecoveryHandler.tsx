import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  completeWebPasswordRecoveryFromUrl,
  getPendingBrowserRecoveryUrl,
  markWebPasswordRecoveryInvalid,
  markWebPasswordRecoveryReady,
} from "@/lib/webPasswordRecovery";
import { clearCapturedInitialAuthReturnUrl } from "@/lib/webAuthReturnBootstrap";
import { matchesAuthRedirectPath } from "@shared/authRedirect";

export function WebPasswordRecoveryHandler() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastHandledUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "PASSWORD_RECOVERY") return;
      markWebPasswordRecoveryReady(session?.user?.id ?? null);
      if (!matchesAuthRedirectPath(window.location.pathname, "reset-password")) {
        navigate("/reset-password", { replace: true });
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useLayoutEffect(() => {
    const currentUrl = window.location.href;
    const pendingRecoveryUrl = getPendingBrowserRecoveryUrl(currentUrl);
    if (!pendingRecoveryUrl) return;
    if (lastHandledUrlRef.current === pendingRecoveryUrl) return;

    lastHandledUrlRef.current = pendingRecoveryUrl;
    let cancelled = false;

    void (async () => {
      const result = await completeWebPasswordRecoveryFromUrl(pendingRecoveryUrl);
      if (cancelled || !result.handled || !result.recovery) return;

      if (result.error) {
        markWebPasswordRecoveryInvalid(result.error.message);
      } else {
        markWebPasswordRecoveryReady(result.sessionUserId);
      }

      clearCapturedInitialAuthReturnUrl();

      const alreadyOnResetPassword =
        matchesAuthRedirectPath(window.location.pathname, "reset-password")
        && !window.location.search
        && !window.location.hash;

      if (!alreadyOnResetPassword) {
        navigate("/reset-password", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search, location.hash, navigate]);

  return null;
}
