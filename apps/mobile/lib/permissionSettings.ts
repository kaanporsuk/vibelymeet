import { useEffect, useRef, type MutableRefObject } from 'react';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';

type SettingsRefreshOptions = {
  enabled?: boolean;
  wasOpenedRef: MutableRefObject<boolean>;
  refresh: () => Promise<unknown> | unknown;
  source: string;
};

function devWarn(source: string, error: unknown) {
  if (__DEV__) {
    console.warn(`[permissionSettings] ${source}:`, error);
  }
}

export async function openPermissionSettings(source: string): Promise<boolean> {
  try {
    await Linking.openSettings();
    return true;
  } catch (primaryError) {
    if (Platform.OS === 'ios') {
      try {
        await Linking.openURL('app-settings:');
        return true;
      } catch (fallbackError) {
        devWarn(`${source} openSettings failed`, fallbackError);
      }
    } else {
      devWarn(`${source} openSettings failed`, primaryError);
    }
  }
  return false;
}

export function useSettingsReturnRefresh({
  enabled = true,
  wasOpenedRef,
  refresh,
  source,
}: SettingsRefreshOptions) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return undefined;
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active' || !wasOpenedRef.current) return;
      wasOpenedRef.current = false;
      void Promise.resolve(refreshRef.current()).catch((error) => {
        devWarn(`${source} refresh after settings failed`, error);
      });
    });
    return () => sub.remove();
  }, [enabled, source, wasOpenedRef]);
}
