import {
  createMediaPlaybackSessionPolicy,
  type MediaConnectionSnapshot,
  PREWARM_SESSION_BYTE_LIMIT,
  REBUFFER_DEGRADE_THRESHOLD,
  REBUFFER_DEGRADE_WINDOW_MS,
} from '../../../shared/media/playback-session-policy-core';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

let connectionSubscribed = false;
let nativeConnectionSnapshot: MediaConnectionSnapshot = {
  connectionType: 'unknown',
  effectiveType: 'unknown',
  saveData: false,
};

function updateConnectionSnapshot(state: NetInfoState): void {
  const details = state.details as { cellularGeneration?: string | null; isConnectionExpensive?: boolean } | null;
  nativeConnectionSnapshot = {
    connectionType: state.type ?? 'unknown',
    effectiveType: state.type === 'cellular'
      ? details?.cellularGeneration ?? 'cellular'
      : state.type ?? 'unknown',
    saveData: details?.isConnectionExpensive === true,
  };
}

function primeConnectionSnapshot(): void {
  if (connectionSubscribed) return;
  connectionSubscribed = true;
  void NetInfo.fetch().then(updateConnectionSnapshot).catch(() => {});
  NetInfo.addEventListener(updateConnectionSnapshot);
}

primeConnectionSnapshot();

const policy = createMediaPlaybackSessionPolicy({
  getConnectionSnapshot: () => {
    primeConnectionSnapshot();
    return nativeConnectionSnapshot;
  },
});

export {
  PREWARM_SESSION_BYTE_LIMIT,
  REBUFFER_DEGRADE_THRESHOLD,
  REBUFFER_DEGRADE_WINDOW_MS,
};

export const {
  recordMediaPlaybackRebuffer,
  isMediaPlaybackQoeDegraded,
  recordMediaPlaybackStartup,
  mediaConnectionSnapshot,
  canPrewarmMedia,
  recordMediaPrewarmBytes,
  reserveMediaPrewarmBudgetForSource,
  getMediaPlaybackQoeSnapshot,
} = policy;
