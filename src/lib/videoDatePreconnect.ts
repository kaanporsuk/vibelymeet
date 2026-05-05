// Web-only preconnect helper for the Video Date launch flow.
//
// Once `ensureVideoDateRoom` returns the actual Daily room URL, we inject a
// `<link rel="preconnect">` for that origin so the TLS handshake completes
// before the user taps "I'm ready". The Supabase Functions origin (used by
// `prepare_date_entry`) is preconnected too — it's a sibling round-trip on
// the same critical path.
//
// Avoids hardcoding `*.daily.co` subdomains because `DAILY_DOMAIN` is a
// server-side env var and the resolved room origin can vary by deployment.

const PRECONNECT_DATA_ATTR = "data-vibely-video-date-preconnect";

type Injection = { origin: string; element: HTMLLinkElement };

function safeOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function injectPreconnect(origin: string): Injection | null {
  if (typeof document === "undefined" || !document.head) return null;
  const existing = document.head.querySelector<HTMLLinkElement>(
    `link[${PRECONNECT_DATA_ATTR}][href="${origin}"]`,
  );
  if (existing) {
    return { origin, element: existing };
  }
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = origin;
  link.crossOrigin = "anonymous";
  link.setAttribute(PRECONNECT_DATA_ATTR, "1");
  document.head.appendChild(link);
  return { origin, element: link };
}

/**
 * Injects deduped preconnect hints for the given Daily room URL plus, if
 * provided, the Supabase Functions origin. Returns a remover that detaches
 * any links this call inserted (links present from a prior call are not
 * removed because they may still be in use by other surfaces).
 */
export function addVideoDatePreconnect(
  roomUrl: string | null | undefined,
  supabaseFunctionsUrl?: string | null,
): () => void {
  const targets: Array<string> = [];
  const roomOrigin = safeOrigin(roomUrl);
  if (roomOrigin) targets.push(roomOrigin);
  const functionsOrigin = safeOrigin(supabaseFunctionsUrl);
  if (functionsOrigin && functionsOrigin !== roomOrigin) targets.push(functionsOrigin);

  if (targets.length === 0) {
    return () => {};
  }

  const insertedByThisCall: Array<HTMLLinkElement> = [];
  for (const origin of targets) {
    const before = document.head?.querySelector(
      `link[${PRECONNECT_DATA_ATTR}][href="${origin}"]`,
    );
    const injection = injectPreconnect(origin);
    if (injection && !before) {
      insertedByThisCall.push(injection.element);
    }
  }

  return () => {
    for (const element of insertedByThisCall) {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }
  };
}
