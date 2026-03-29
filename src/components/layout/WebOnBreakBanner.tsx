import { useState } from "react";
import { useUserProfile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const END_BREAK_UPDATE = {
  account_paused: false,
  account_paused_until: null,
  is_paused: false,
  paused_until: null,
  paused_at: null,
  pause_reason: null,
  discoverable: true,
  discovery_mode: "visible" as const,
};

/** Sticky amber strip when the signed-in user’s profile is paused (break / hidden from discovery). */
export function WebOnBreakBanner() {
  const { user, refreshProfile } = useUserProfile();
  const [busy, setBusy] = useState(false);

  if (!user?.isPaused) return null;

  const endBreak = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.from("profiles").update(END_BREAK_UPDATE).eq("id", user.id);
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
