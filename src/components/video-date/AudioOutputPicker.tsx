import { motion, AnimatePresence } from "framer-motion";
import { Check, Headphones, RefreshCw, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applyAudioOutputDeviceToElement,
  enumerateAudioOutputDevices,
  isAudioDeviceEnumerationSupported,
  isSetSinkIdSupported,
  loadStoredAudioOutputDeviceId,
  storeAudioOutputDeviceId,
  VIDEO_DATE_AUDIO_OUTPUT_DEFAULT_ID,
  type AudioOutputDevice,
  type ApplyAudioOutputResult,
} from "@/lib/videoDateAudioOutput";

interface AudioOutputPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** The remote `<video>` element whose audio sink we manage. */
  remoteMediaElement: HTMLMediaElement | null;
  /** Optional analytics callback fired on successful changes. */
  onDeviceChanged?: (deviceId: string) => void;
}

const FALLBACK_REASON_COPY: Record<string, string> = {
  unsupported_browser:
    "This browser doesn't let apps choose the audio output device. Use your system audio settings to switch headphones or speakers.",
  device_not_found:
    "We couldn't find that audio device anymore. Pick a different output below.",
  permission_denied:
    "Your browser blocked the audio change. Reload the page and grant microphone permission, then try again.",
  abort: "The audio change was interrupted. Try again.",
  unknown_error: "Couldn't switch audio output. Try a different device.",
};

export const AudioOutputPicker = ({
  isOpen,
  onClose,
  remoteMediaElement,
  onDeviceChanged,
}: AudioOutputPickerProps) => {
  const setSinkSupported = isSetSinkIdSupported();
  const enumerationSupported = isAudioDeviceEnumerationSupported();

  const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string>(
    () => loadStoredAudioOutputDeviceId() ?? VIDEO_DATE_AUDIO_OUTPUT_DEFAULT_ID,
  );
  const [isApplying, setIsApplying] = useState(false);
  const [isEnumerating, setIsEnumerating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const fallbackHelpText = useMemo(() => {
    if (!enumerationSupported) {
      return "This browser can't list audio output devices. Use your system audio settings to choose your speaker or headphones.";
    }
    if (!setSinkSupported) {
      return FALLBACK_REASON_COPY.unsupported_browser;
    }
    return null;
  }, [enumerationSupported, setSinkSupported]);

  const refreshDevices = useCallback(async () => {
    if (!enumerationSupported) {
      setDevices([]);
      return;
    }
    setIsEnumerating(true);
    try {
      const list = await enumerateAudioOutputDevices();
      setDevices(list);
    } finally {
      setIsEnumerating(false);
    }
  }, [enumerationSupported]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshDevices();
  }, [isOpen, refreshDevices]);

  // Re-enumerate on device change (USB headset plug/unplug).
  useEffect(() => {
    if (!enumerationSupported) return;
    const handler = () => {
      void refreshDevices();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
    };
  }, [enumerationSupported, refreshDevices]);

  const handleSelect = useCallback(
    async (deviceId: string) => {
      if (isApplying) return;
      setIsApplying(true);
      setLastError(null);
      try {
        const result: ApplyAudioOutputResult = await applyAudioOutputDeviceToElement(
          remoteMediaElement,
          deviceId,
        );
        if (result.ok) {
          storeAudioOutputDeviceId(deviceId === VIDEO_DATE_AUDIO_OUTPUT_DEFAULT_ID ? null : deviceId);
          setActiveDeviceId(deviceId);
          onDeviceChanged?.(deviceId);
        } else {
          const reasonKey: string = result.reason ?? "unknown_error";
          const copy = FALLBACK_REASON_COPY[reasonKey] ?? FALLBACK_REASON_COPY.unknown_error;
          setLastError(copy);
        }
      } finally {
        setIsApplying(false);
      }
    },
    [isApplying, onDeviceChanged, remoteMediaElement],
  );

  const showPicker = setSinkSupported && enumerationSupported && devices.length > 0;
  const showEmptyHint = setSinkSupported && enumerationSupported && devices.length === 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-50"
          />

          <motion.div
            role="dialog"
            aria-label="Audio output settings"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] bg-background rounded-t-3xl border-t border-border/50 overflow-hidden flex flex-col"
          >
            <div className="flex justify-center py-3">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>

            <div className="absolute top-3 right-4 z-10">
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-secondary/80"
                aria-label="Close audio settings"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-4">
              <div className="flex items-center gap-3 pt-1">
                <div className="w-10 h-10 rounded-2xl bg-primary/15 flex items-center justify-center">
                  <Headphones className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-display font-semibold text-foreground">
                    Audio output
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Pick where you hear your date.
                  </p>
                </div>
                {enumerationSupported && setSinkSupported && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Refresh audio device list"
                    className="w-9 h-9 rounded-full"
                    onClick={() => void refreshDevices()}
                    disabled={isEnumerating}
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${isEnumerating ? "animate-spin" : ""}`}
                    />
                  </Button>
                )}
              </div>

              {fallbackHelpText && (
                <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
                  {fallbackHelpText}
                </div>
              )}

              {showEmptyHint && (
                <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
                  No audio outputs were detected yet. Plug in headphones or
                  reload the page after granting microphone access, then tap
                  refresh.
                </div>
              )}

              {showPicker && (
                <div className="space-y-2">
                  {devices.map((device) => {
                    const isActive = device.deviceId === activeDeviceId;
                    return (
                      <button
                        key={device.deviceId}
                        type="button"
                        onClick={() => void handleSelect(device.deviceId)}
                        disabled={isApplying}
                        aria-pressed={isActive}
                        className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                          isActive
                            ? "border-primary/60 bg-primary/10 text-foreground"
                            : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/70"
                        } ${isApplying ? "opacity-60" : ""}`}
                      >
                        <Volume2
                          className={`w-4 h-4 ${
                            isActive ? "text-primary" : "text-muted-foreground"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {device.label}
                          </div>
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            {device.isDefault
                              ? "System default"
                              : device.isCommunications
                                ? "Communications"
                                : "Output device"}
                          </div>
                        </div>
                        {isActive && (
                          <Check className="w-4 h-4 text-primary" aria-hidden />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {lastError && (
                <div
                  role="alert"
                  className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                >
                  {lastError}
                </div>
              )}

              <div className="rounded-2xl border border-border/60 bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                Tip: For the clearest audio on a video date, use wired
                headphones or a single Bluetooth headset. If your partner
                sounds muffled, switch outputs here and the change applies
                instantly.
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
