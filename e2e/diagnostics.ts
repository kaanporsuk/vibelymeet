import {
  expect,
  test as base,
  type ConsoleMessage,
  type Dialog,
  type Frame,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from "@playwright/test";

type E2eDiagnosticEvent = {
  type: string;
  text?: string;
  url?: string;
  method?: string;
  status?: number;
  timestamp: string;
};

export type AttachedBrowserDiagnostics = {
  events: E2eDiagnosticEvent[];
  unexpected: E2eDiagnosticEvent[];
  finalize: () => Promise<void>;
};

const MAX_EVENTS = 300;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const TOKEN_RE = /\b(?:access_token|refresh_token|token|code|signature|sig|jwt|apikey|api_key)=([^&#]+)/gi;
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;

const ALLOWED_FAILURE_URLS = [
  /cdn\.onesignal\.com/i,
  /posthog/i,
  /sentry/i,
  /vercel-insights/i,
  /favicon/i,
];

const ALLOWED_CONSOLE_PATTERNS = [
  /OneSignal.*not set/i,
  /OneSignal.*Skipped/i,
  /PostHog/i,
];

function sanitizeText(value: string | undefined): string | undefined {
  if (!value) return value;
  return value
    .replace(TOKEN_RE, (_match, _token, offset, source) => {
      const prefix = source.slice(offset).split("=")[0];
      return `${prefix}=[redacted]`;
    })
    .replace(UUID_RE, "[uuid]")
    .replace(LONG_TOKEN_RE, "[redacted-token]")
    .slice(0, 700);
}

function sanitizeUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value);
    return sanitizeText(`${url.origin}${url.pathname}`);
  } catch {
    return sanitizeText(value.split(/[?#]/)[0]);
  }
}

function isAllowedFailure(event: E2eDiagnosticEvent): boolean {
  const target = `${event.url ?? ""} ${event.text ?? ""}`;
  if (ALLOWED_FAILURE_URLS.some((pattern) => pattern.test(target))) return true;
  if (event.type.startsWith("console:") && ALLOWED_CONSOLE_PATTERNS.some((pattern) => pattern.test(target))) return true;
  return false;
}

function isUnexpected(event: E2eDiagnosticEvent): boolean {
  if (isAllowedFailure(event)) return false;
  if (event.type === "pageerror" || event.type === "requestfailed") return true;
  if (event.type === "response" && typeof event.status === "number" && event.status >= 400) return true;
  if (event.type === "console:error") return true;
  return false;
}

function oneSignalPageSdkMock(): string {
  return `
    (() => {
      const fakeOneSignal = {
        init: async () => undefined,
        Notifications: {
          addEventListener: () => undefined,
          requestPermission: async () => Notification.permission === "granted",
        },
        User: {
          PushSubscription: {
            id: "e2e-player-id",
            optedIn: true,
            addEventListener: () => undefined,
          },
        },
        login: async () => undefined,
        logout: async () => undefined,
      };
      const runDeferred = () => {
        const queue = window.OneSignalDeferred = window.OneSignalDeferred || [];
        if (!queue.__vibelyE2ePatched) {
          const originalPush = queue.push.bind(queue);
          queue.push = (...callbacks) => {
            const result = originalPush(...callbacks);
            callbacks.forEach((callback) => {
              if (typeof callback === "function") Promise.resolve().then(() => callback(fakeOneSignal));
            });
            return result;
          };
          Object.defineProperty(queue, "__vibelyE2ePatched", { value: true });
        }
        while (queue.length > 0) {
          const callback = queue.shift();
          if (typeof callback === "function") Promise.resolve().then(() => callback(fakeOneSignal));
        }
      };
      window.__vibelyOneSignalMock = fakeOneSignal;
      runDeferred();
      window.setInterval(runDeferred, 25);
    })();
  `;
}

export async function attachBrowserDiagnostics(
  page: Page,
  testInfo: TestInfo,
  label = "page",
): Promise<AttachedBrowserDiagnostics> {
  const events: E2eDiagnosticEvent[] = [];
  const unexpected: E2eDiagnosticEvent[] = [];

  const push = (event: Omit<E2eDiagnosticEvent, "timestamp">) => {
    const item: E2eDiagnosticEvent = {
      ...event,
      text: sanitizeText(event.text),
      url: sanitizeUrl(event.url),
      timestamp: new Date().toISOString(),
    };
    if (events.length < MAX_EVENTS) events.push(item);
    if (isUnexpected(item)) unexpected.push(item);
  };

  await page.route("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: oneSignalPageSdkMock(),
    });
  });

  await page.addInitScript(() => {
    const win = window as typeof window & {
      __vibelyE2eClicks?: Array<Record<string, unknown>>;
    };
    win.__vibelyE2eClicks = [];
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target instanceof Element ? event.target.closest("button,a,[role='button'],input,label") : null;
        if (!target) return;
        const element = target as HTMLElement;
        win.__vibelyE2eClicks?.push({
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          ariaLabel: element.getAttribute("aria-label"),
          type: element.getAttribute("type"),
          href: element instanceof HTMLAnchorElement ? element.href : null,
          text: (element.innerText || element.getAttribute("value") || "").trim().slice(0, 80),
          path: window.location.pathname,
          at: new Date().toISOString(),
        });
      },
      true,
    );
  });

  const onConsole = (msg: ConsoleMessage) => {
    push({ type: `console:${msg.type()}`, text: msg.text() });
  };
  const onPageError = (error: Error) => push({ type: "pageerror", text: String(error) });
  const onRequestFailed = (request: Request) =>
    push({
      type: "requestfailed",
      method: request.method(),
      url: request.url(),
      text: request.failure()?.errorText ?? "failed",
    });
  const onResponse = (response: Response) => {
    if (response.status() >= 400) {
      push({
        type: "response",
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
      });
    }
  };
  const onDialog = async (dialog: Dialog) => {
    push({ type: "dialog", text: `${dialog.type()}: ${dialog.message()}` });
    await dialog.dismiss().catch(() => undefined);
  };
  const onFrameNavigated = (frame: Frame) => {
    if (frame === page.mainFrame()) push({ type: "navigation", url: frame.url() });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);
  page.on("dialog", onDialog);
  page.on("framenavigated", onFrameNavigated);

  const finalize = async () => {
    if (!page.isClosed()) {
      const clicks = await page
        .evaluate(() => (window as typeof window & { __vibelyE2eClicks?: unknown[] }).__vibelyE2eClicks ?? [])
        .catch(() => []);
      for (const click of clicks as Array<Record<string, unknown>>) {
        push({
          type: "click",
          text: JSON.stringify(click),
          url: typeof click.path === "string" ? click.path : undefined,
        });
      }

      if (unexpected.length > 0 || testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
        if (screenshot) {
          await testInfo.attach(`${label}-failure-screenshot`, {
            body: screenshot,
            contentType: "image/png",
          });
        }
      }
    }

    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("requestfailed", onRequestFailed);
    page.off("response", onResponse);
    page.off("dialog", onDialog);
    page.off("framenavigated", onFrameNavigated);

    await testInfo.attach(`${label}-browser-diagnostics`, {
      body: JSON.stringify({ events, unexpected }, null, 2),
      contentType: "application/json",
    });
  };

  return { events, unexpected, finalize };
}

export const test = base.extend<{ browserDiagnostics: void }>({
  browserDiagnostics: [
    async ({ page }, use, testInfo) => {
      const diagnostics = await attachBrowserDiagnostics(page, testInfo);
      await use();
      await diagnostics.finalize();
      expect(diagnostics.unexpected, "unexpected browser diagnostics").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
