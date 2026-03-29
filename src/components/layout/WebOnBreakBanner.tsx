import { useState } from "react";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { END_ACCOUNT_BREAK_PROFILE_UPDATE } from "@/lib/endAccountBreak";

/** Sticky amber strip when the signed-in user’s profile is paused (break / hidden from discovery). */
export function WebOnBreakBanner() {
  const { user, refreshProfile } = useUserProfile();
  const [busy, setBusy] = useState(false);

  if (!user?.isPaused) return null;

  const endBreak = async () => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update(END_ACCOUNT_BREAK_PROFILE_UPDATE)
        .eq("id", user.id);
      if (error) {
        console.error("[WebOnBreakBanner]", error);
        return;
      }
      await refreshProfile();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className="sticky top-0 z-[100] flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2 text-sm text-amber-500"
    >
      <p className="min-w-0 flex-1">
        {"You're on a break — hidden from discovery. Matches & chats are active."}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
        disabled={busy}
        onClick={() => void endBreak()}
      >
        {busy ? "…" : "End break"}
      </Button>
    </div>
  );
}
