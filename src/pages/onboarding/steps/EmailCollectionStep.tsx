import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EmailCollectionStepProps {
  onNext: () => void;
  onSkip: () => void;
}

export const EmailCollectionStep = ({ onNext, onSkip }: EmailCollectionStepProps) => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const valid = useMemo(() => EMAIL_RE.test(email.trim()), [email]);

  const submit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: email.trim() });
      if (error) throw error;
      setMessage(`We sent a confirmation link to ${email.trim()}. You can verify it anytime.`);
      setTimeout(onNext, 2000);
    } catch {
      setMessage("Couldn't update email. Try again or skip.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pt-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          Add your email
        </h1>
        <p className="text-muted-foreground mt-2">
          For account recovery and important updates. We'll never spam you.
        </p>
      </div>

      <Input
        type="email"
        autoFocus
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid) submit();
        }}
        className="bg-secondary/50 border-secondary text-lg py-6"
      />

      {message && (
        <p className="text-sm text-muted-foreground">{message}</p>
      )}

      <Button
        onClick={submit}
        disabled={!valid || loading}
        className="w-full bg-gradient-to-r from-primary to-pink-500 hover:opacity-90 text-white font-semibold py-6"
      >
        {loading ? "Saving..." : "Continue"}
      </Button>

      <button
        onClick={onSkip}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
      >
        Skip for now
      </button>
    </div>
  );
};
