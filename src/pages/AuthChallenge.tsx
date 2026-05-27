import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { AuthTurnstile } from "@/components/auth/AuthTurnstile";
import { webTurnstileEnabled } from "@/lib/authTurnstile";
import { Button } from "@/components/ui/button";

const ALLOWED_NATIVE_RETURN_PROTOCOLS = new Set([
  "com.vibelymeet.vibely:",
]);

function safeNativeReturnUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (ALLOWED_NATIVE_RETURN_PROTOCOLS.has(url.protocol)) return url;
    const devChallengeHost =
      window.location.hostname === "localhost"
      || window.location.hostname === "127.0.0.1"
      || window.location.hostname.endsWith(".local");
    if (devChallengeHost && (url.protocol === "exp:" || url.protocol === "exps:")) return url;
    return null;
  } catch {
    return null;
  }
}

function safeTurnstileAction(raw: string | null): string {
  const action = (raw || "native_auth")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 32);
  return action || "native_auth";
}

function redirectWithResult(returnUrl: URL, params: Record<string, string>) {
  for (const [key, value] of Object.entries(params)) {
    returnUrl.searchParams.set(key, value);
  }
  window.location.assign(returnUrl.toString());
}

export default function AuthChallenge() {
  const [captchaToken, setCaptchaToken] = useState("");
  const [redirecting, setRedirecting] = useState(false);

  const { returnUrl, action } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      returnUrl: safeNativeReturnUrl(params.get("return_to")),
      action: safeTurnstileAction(params.get("action")),
    };
  }, []);

  useEffect(() => {
    if (!returnUrl) return;
    if (webTurnstileEnabled()) return;
    setRedirecting(true);
    redirectWithResult(returnUrl, { captchaUnavailable: "1" });
  }, [returnUrl]);

  useEffect(() => {
    if (!returnUrl || !captchaToken) return;
    setRedirecting(true);
    redirectWithResult(returnUrl, {
      captchaProvider: "turnstile",
      captchaToken,
    });
  }, [captchaToken, returnUrl]);

  if (!returnUrl) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center space-y-4">
          <ShieldCheck className="mx-auto h-12 w-12 text-primary" />
          <h1 className="text-xl font-semibold">Verification unavailable</h1>
          <p className="text-sm text-muted-foreground">
            Open this check from the Vibely app to continue.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center space-y-5">
        <ShieldCheck className="mx-auto h-12 w-12 text-primary" />
        <h1 className="text-xl font-semibold">Quick Verification</h1>
        {webTurnstileEnabled() ? (
          <AuthTurnstile
            action={action}
            onTokenChange={setCaptchaToken}
            className="flex justify-center"
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              setRedirecting(true);
              redirectWithResult(returnUrl, { captchaUnavailable: "1" });
            }}
          >
            Continue
          </Button>
        )}
        {redirecting ? (
          <p className="inline-flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Returning to Vibely
          </p>
        ) : null}
      </div>
    </main>
  );
}
