import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

export type PauseStatus = {
  isPaused: boolean;
  isDeactivated: boolean;
  isTimedBreak: boolean;
  isIndefiniteBreak: boolean;
  pausedUntil: Date | null;
  remainingLabel: string | null;
};

type PauseRow = {
  account_paused: boolean | null;
  account_paused_until: string | null;
  pause_reason: string | null;
  is_paused: boolean | null;
  paused_until: string | null;
};

function isFuture(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return new Date(iso) > new Date();
}

const defaultStatus: PauseStatus = {
  isPaused: false,
  isDeactivated: false,
  isTimedBreak: false,
  isIndefiniteBreak: false,
  pausedUntil: null,
  remainingLabel: null,
};

export function useAccountPauseStatus(): PauseStatus {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ['account-pause-status', user?.id],
    queryFn: async (): Promise<PauseRow | null> => {
      if (!user?.id) return null;
      const { data: row } = await supabase
        .from('profiles')
        .select('account_paused, account_paused_until, pause_reason, is_paused, paused_until')
        .eq('id', user.id)
        .maybeSingle();
      return row as PauseRow | null;
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  if (!data) return defaultStatus;

  const legacyEffective =
    data.is_paused === true && (data.paused_until == null || isFuture(data.paused_until));
  const accountEffective =
    data.account_paused === true &&
    (data.account_paused_until == null || isFuture(data.account_paused_until));

  if (!legacyEffective && !accountEffective) {
    return defaultStatus;
  }

  const isDeactivated = data.pause_reason === 'deactivated';

  let pausedUntil: Date | null = null;
  if (accountEffective && data.account_paused_until) {
    pausedUntil = new Date(data.account_paused_until);
  } else if (legacyEffective && data.paused_until) {
    pausedUntil = new Date(data.paused_until);
  }

  const isTimedBreak = pausedUntil != null && !isDeactivated;
  const isIndefiniteBreak = pausedUntil == null && !isDeactivated;

  let remainingLabel: string | null = null;
  if (pausedUntil) {
    const diffMs = pausedUntil.getTime() - Date.now();
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    const diffD = Math.floor(diffH / 24);
    if (diffD > 0) {
      remainingLabel = `${diffD}d ${diffH % 24}h`;
    } else if (diffH > 0) {
      remainingLabel = `${diffH}h ${Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))}m`;
    } else {
      remainingLabel = `${Math.max(1, Math.floor(diffMs / (1000 * 60)))}m`;
    }
  }

  return {
    isPaused: true,
    isDeactivated,
    isTimedBreak,
    isIndefiniteBreak,
    pausedUntil,
    remainingLabel,
  };
}
