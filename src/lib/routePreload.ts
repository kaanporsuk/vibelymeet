import type { ComponentType } from "react";

type RouteModule = { default: ComponentType<unknown> };
type RouteLoader = () => Promise<RouteModule>;

export const routeLoaders = {
  index: () => import("@/pages/Index") as Promise<RouteModule>,
  auth: () => import("@/pages/Auth") as Promise<RouteModule>,
  entryRecovery: () => import("@/pages/EntryRecovery") as Promise<RouteModule>,
  inviteRedirect: () => import("@/pages/InviteRedirect") as Promise<RouteModule>,
  eventShortRedirect: () => import("@/pages/EventShortRedirect") as Promise<RouteModule>,
  resetPassword: () => import("@/pages/ResetPassword") as Promise<RouteModule>,
  onboarding: () => import("@/pages/onboarding") as Promise<RouteModule>,
  dashboard: () => import("@/pages/Dashboard") as Promise<RouteModule>,
  events: () => import("@/pages/Events") as Promise<RouteModule>,
  eventDetails: () => import("@/pages/EventDetails") as Promise<RouteModule>,
  eventLobby: () => import("@/pages/EventLobby") as Promise<RouteModule>,
  matches: () => import("@/pages/Matches") as Promise<RouteModule>,
  chat: () => import("@/pages/Chat") as Promise<RouteModule>,
  profile: () => import("@/pages/Profile") as Promise<RouteModule>,
  profilePreview: () => import("@/pages/ProfilePreview") as Promise<RouteModule>,
  settings: () => import("@/pages/Settings") as Promise<RouteModule>,
  referrals: () => import("@/pages/Referrals") as Promise<RouteModule>,
  videoDate: () => import("@/pages/VideoDate") as Promise<RouteModule>,
  readyRedirect: () => import("@/pages/ReadyRedirect") as Promise<RouteModule>,
  adminCreateEvent: () => import("@/pages/AdminCreateEvent") as Promise<RouteModule>,
  adminDashboard: () => import("@/pages/admin/AdminDashboard") as Promise<RouteModule>,
  vibeStudio: () => import("@/pages/VibeStudio") as Promise<RouteModule>,
  schedule: () => import("@/pages/Schedule") as Promise<RouteModule>,
  howItWorks: () => import("@/pages/HowItWorks") as Promise<RouteModule>,
  privacy: () => import("@/pages/legal/PrivacyPolicy") as Promise<RouteModule>,
  terms: () => import("@/pages/legal/TermsOfService") as Promise<RouteModule>,
  deleteAccount: () => import("@/pages/legal/DeleteAccountWeb") as Promise<RouteModule>,
  communityGuidelines: () => import("@/pages/legal/CommunityGuidelines") as Promise<RouteModule>,
  premium: () => import("@/pages/Premium") as Promise<RouteModule>,
  subscriptionSuccess: () => import("@/pages/SubscriptionSuccess") as Promise<RouteModule>,
  subscriptionCancel: () => import("@/pages/SubscriptionCancel") as Promise<RouteModule>,
  eventPaymentSuccess: () => import("@/pages/EventPaymentSuccess") as Promise<RouteModule>,
  credits: () => import("@/pages/Credits") as Promise<RouteModule>,
  creditsSuccess: () => import("@/pages/CreditsSuccess") as Promise<RouteModule>,
  userProfile: () => import("@/pages/UserProfile") as Promise<RouteModule>,
  adminLogin: () => import("@/pages/admin/AdminLogin") as Promise<RouteModule>,
  notFound: () => import("@/pages/NotFound") as Promise<RouteModule>,
} satisfies Record<string, RouteLoader>;

const preloaded = new Set<string>();
const preloadPromises = new Map<string, Promise<RouteModule>>();

function requestIdle(callback: () => void) {
  if (typeof window === "undefined") return;
  const ric = (window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
  }).requestIdleCallback;
  if (typeof ric === "function") {
    ric(callback, { timeout: 2500 });
    return;
  }
  window.setTimeout(callback, 350);
}

export function preloadRoute(key: keyof typeof routeLoaders) {
  if (preloaded.has(key)) return preloadPromises.get(key) ?? null;
  preloaded.add(key);
  const promise = routeLoaders[key]().catch((error) => {
    preloaded.delete(key);
    preloadPromises.delete(key);
    throw error;
  });
  preloadPromises.set(key, promise);
  void promise.catch(() => undefined);
  return promise;
}

export function preloadRouteOnIdle(key: keyof typeof routeLoaders) {
  requestIdle(() => preloadRoute(key));
}
