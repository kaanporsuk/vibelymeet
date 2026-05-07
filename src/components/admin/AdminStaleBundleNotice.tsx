import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const ENTRY_MODULE_PATTERN = /\/assets\/index-[^"']+\.js/;

function entryModuleFromDocument(doc: Document): string | null {
  const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  for (const script of scripts) {
    try {
      const pathname = new URL(script.src, window.location.origin).pathname;
      if (ENTRY_MODULE_PATTERN.test(pathname)) return pathname;
    } catch {
      if (ENTRY_MODULE_PATTERN.test(script.src)) return script.src;
    }
  }
  return null;
}

function entryModuleFromHtml(html: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return entryModuleFromDocument(doc);
  } catch {
    return null;
  }
}

const AdminStaleBundleNotice = () => {
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const currentEntryModule = entryModuleFromDocument(document);
    if (!currentEntryModule) return;

    let cancelled = false;

    const checkForNewBundle = async () => {
      try {
        const response = await fetch(`${window.location.pathname}?vibely_bundle_check=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const liveEntryModule = entryModuleFromHtml(await response.text());
        if (!cancelled && liveEntryModule && liveEntryModule !== currentEntryModule) {
          setIsStale(true);
        }
      } catch {
        // A failed freshness probe should not add noise to an already-sensitive admin surface.
      }
    };

    void checkForNewBundle();
    const intervalId = window.setInterval(checkForNewBundle, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  if (!isStale) return null;

  return (
    <div className="mx-6 mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div>
            <div className="font-medium text-amber-100">A newer admin build is available.</div>
            <div className="mt-1 text-amber-100/80">
              Reload this tab before continuing admin work.
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-amber-400/40 text-amber-100 hover:bg-amber-400/10"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="h-4 w-4" />
          Reload
        </Button>
      </div>
    </div>
  );
};

export default AdminStaleBundleNotice;
