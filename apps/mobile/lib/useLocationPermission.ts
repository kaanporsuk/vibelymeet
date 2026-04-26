import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';

export type LocationPermissionStatus = Location.PermissionStatus | 'unknown';

export type LocationPermissionSnapshot = {
  status: LocationPermissionStatus;
  canAskAgain: boolean | null;
  servicesEnabled: boolean | null;
  error: Error | null;
};

export type LocationPermissionState = LocationPermissionSnapshot & {
  granted: boolean;
  denied: boolean;
  undetermined: boolean;
  isLoading: boolean;
  refresh: () => Promise<LocationPermissionSnapshot>;
  request: () => Promise<LocationPermissionSnapshot>;
  openSettings: () => Promise<void>;
  requestOrOpenSettings: () => Promise<LocationPermissionSnapshot>;
};

const UNKNOWN_LOCATION_PERMISSION: LocationPermissionSnapshot = {
  status: 'unknown',
  canAskAgain: null,
  servicesEnabled: null,
  error: null,
};

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value.trim()) return new Error(value);
  return new Error(fallback);
}

async function readServicesEnabled(): Promise<{ value: boolean | null; error: Error | null }> {
  try {
    return { value: await Location.hasServicesEnabledAsync(), error: null };
  } catch (e) {
    return { value: null, error: toError(e, 'location_services_check_failed') };
  }
}

export async function readLocationPermissionSnapshot(): Promise<LocationPermissionSnapshot> {
  const [permission, services] = await Promise.allSettled([
    Location.getForegroundPermissionsAsync(),
    readServicesEnabled(),
  ]);

  const servicesEnabled =
    services.status === 'fulfilled' ? services.value.value : null;
  const servicesError =
    services.status === 'fulfilled' ? services.value.error : toError(services.reason, 'location_services_check_failed');

  if (permission.status === 'rejected') {
    return {
      ...UNKNOWN_LOCATION_PERMISSION,
      servicesEnabled,
      error: toError(permission.reason, 'location_permission_check_failed'),
    };
  }

  return {
    status: permission.value.status,
    canAskAgain: permission.value.canAskAgain ?? null,
    servicesEnabled,
    error: servicesError,
  };
}

export async function requestLocationPermissionSnapshot(): Promise<LocationPermissionSnapshot> {
  const services = await readServicesEnabled();

  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    return {
      status: permission.status,
      canAskAgain: permission.canAskAgain ?? null,
      servicesEnabled: services.value,
      error: services.error,
    };
  } catch (e) {
    return {
      status: 'unknown',
      canAskAgain: null,
      servicesEnabled: services.value,
      error: toError(e, 'location_permission_request_failed'),
    };
  }
}

export async function openLocationSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (e) {
    if (__DEV__) console.warn('[locationPermission] openSettings failed:', e);
  }
}

export function useLocationPermission(): LocationPermissionState {
  const [snapshot, setSnapshot] = useState<LocationPermissionSnapshot>(UNKNOWN_LOCATION_PERMISSION);
  const [isLoading, setIsLoading] = useState(true);
  const refreshInFlight = useRef<Promise<LocationPermissionSnapshot> | null>(null);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;

    setIsLoading(true);
    const next = readLocationPermissionSnapshot()
      .then((result) => {
        setSnapshot(result);
        return result;
      })
      .finally(() => {
        refreshInFlight.current = null;
        setIsLoading(false);
      });

    refreshInFlight.current = next;
    return next;
  }, []);

  const request = useCallback(async () => {
    setIsLoading(true);
    const next = await requestLocationPermissionSnapshot();
    setSnapshot(next);
    setIsLoading(false);
    return next;
  }, []);

  const requestOrOpenSettings = useCallback(async () => {
    if (
      snapshot.status === Location.PermissionStatus.UNDETERMINED ||
      (snapshot.status === Location.PermissionStatus.DENIED && snapshot.canAskAgain !== false)
    ) {
      return request();
    }

    await openLocationSettings();
    return snapshot;
  }, [request, snapshot]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshRef.current();
    });
    return () => sub.remove();
  }, [refresh]);

  return useMemo(
    () => ({
      ...snapshot,
      granted: snapshot.status === Location.PermissionStatus.GRANTED,
      denied: snapshot.status === Location.PermissionStatus.DENIED,
      undetermined: snapshot.status === Location.PermissionStatus.UNDETERMINED,
      isLoading,
      refresh,
      request,
      openSettings: openLocationSettings,
      requestOrOpenSettings,
    }),
    [isLoading, refresh, request, requestOrOpenSettings, snapshot],
  );
}
