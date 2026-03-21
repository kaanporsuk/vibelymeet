/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
}

interface Window {
  OneSignal?: {
    Notifications: {
      requestPermission: () => Promise<unknown>;
      permission?: boolean | string;
      addEventListener?: (event: string, handler: (e: unknown) => void) => void;
    };
    User?: {
      PushSubscription?: {
        id?: string | null;
        optedIn?: boolean;
      };
    };
    init?: (options: unknown) => Promise<void>;
    login?: (userId: string) => Promise<void>;
    logout?: () => Promise<void>;
  };
}
