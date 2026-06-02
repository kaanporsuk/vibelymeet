export const WEB_LOCATION_UNAVAILABLE_MESSAGE =
  "Location is not available in this browser. Use a city filter or update your location from profile.";

export const WEB_LOCATION_BLOCKED_MESSAGE =
  "Location is blocked for this site. Allow it in browser site settings, then try again.";

export const WEB_LOCATION_RETRY_OR_CITY_MESSAGE =
  "Could not get your location. Try again, or choose a city filter if available.";

type WebLocationRecoveryCopy = {
  unavailable?: string;
  blocked?: string;
  retry?: string;
};

export function webLocationRecoveryMessage(error: unknown, copy: WebLocationRecoveryCopy = {}): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 1
  ) {
    return copy.blocked ?? WEB_LOCATION_BLOCKED_MESSAGE;
  }
  if (error instanceof Error && error.message === "web_geolocation_unavailable") {
    return copy.unavailable ?? WEB_LOCATION_UNAVAILABLE_MESSAGE;
  }
  return copy.retry ?? WEB_LOCATION_RETRY_OR_CITY_MESSAGE;
}

export function requestCurrentWebLocation(
  options: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 300000,
  },
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("web_geolocation_unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}
