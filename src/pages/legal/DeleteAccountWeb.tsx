import { useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, Loader2 } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const DeleteAccountWeb = () => {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const isConfirmed = confirmText === "DELETE";
  const canSubmit = isEmailValid && isConfirmed && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/request-account-deletion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, reason: reason || null, source: "web" }),
      });
    } catch {
      // Always show success to not reveal if email exists
    }
    setSubmitted(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/40 px-6 py-5">
        <Link to="/" className="flex items-center gap-2">
          <img src="/vibely-logomark.png" alt="Vibely" className="h-8 w-8" />
          <span className="text-xl font-bold bg-gradient-to-r from-neon-violet to-neon-pink bg-clip-text text-transparent">
            Vibely
          </span>
        </Link>
      </header>

      <main className="mx-auto max-w-[480px] px-6 py-10">
        <h1 className="text-2xl font-bold mb-2">Delete Your Vibely Account</h1>
        <p className="text-muted-foreground text-sm mb-8">
          Submit a deletion request even if you can't access the app.
        </p>

        {submitted ? (
          <div className="rounded-xl border border-border/40 bg-card p-6 text-center space-y-4">
            <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
            <h2 className="text-lg font-semibold">Request received</h2>
            <p className="text-sm text-muted-foreground">
              Your account will be reviewed and deleted within 30 days. Check your email for confirmation.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Account email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Reason for leaving (optional)</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="found_someone">Found someone 🎉</SelectItem>
                  <SelectItem value="not_enough_events">Not enough events</SelectItem>
                  <SelectItem value="technical_issues">Technical issues</SelectItem>
                  <SelectItem value="privacy_concerns">Privacy concerns</SelectItem>
                  <SelectItem value="taking_a_break">Taking a break</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">Type DELETE to confirm</Label>
              <Input
                id="confirm"
                placeholder="DELETE"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className={confirmText && !isConfirmed ? "border-destructive" : ""}
              />
            </div>

            <Button
              type="submit"
              variant="destructive"
              className="w-full"
              disabled={!canSubmit}
            >
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting...</>
              ) : (
                "Submit Deletion Request"
              )}
            </Button>
          </form>
        )}

        <p className="mt-8 text-xs text-muted-foreground text-center">
          You can also delete your account directly in the app: Settings → Delete My Account
        </p>
      </main>

      <footer className="border-t border-border/40 px-6 py-6 text-center text-xs text-muted-foreground">
        <div className="flex justify-center gap-6">
          <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
        </div>
        <p className="mt-3">© {new Date().getFullYear()} Vibely. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default DeleteAccountWeb;
