import * as Sentry from "@sentry/react";

/**
 * Cross-platform voice playback fix (web side).
 *
 * Non-Safari browsers (Chrome desktop, Android Chrome, Firefox) can only record
 * `audio/webm;codecs=opus` via MediaRecorder. webm/opus is undecodable on iOS Safari,
 * iOS-native AVPlayer (expo-audio) and desktop Safari, so those voice notes never play
 * for iOS recipients. iOS Safari already records a universal `audio/mp4`/AAC blob.
 *
 * This helper transcodes a recorded webm/ogg voice blob to MP3 (`audio/mpeg`) before
 * upload. MP3 plays on every target platform and is already supported end-to-end by the
 * backend (sniffing, validation declarations, and the media-url serving mime map), so no
 * backend change is required. Already-universal blobs (mp4/aac/mpeg) pass through untouched.
 *
 * Fail-safe: any decode/encode failure (or a browser without WebAudio) returns the
 * original blob so sending is never blocked — behaviour is then no worse than before.
 */

const MP3_BITRATE_KBPS = 128;
const PCM_BLOCK_SIZE = 1152; // MP3 frame size lamejs expects per encode call.

// iOS-universal containers we should never re-encode.
const UNIVERSAL_AUDIO_TYPES = ["audio/mp4", "audio/aac", "audio/mpeg", "audio/m4a", "audio/x-m4a"];

type Mp3EncoderLike = {
  encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array | Uint8Array;
  flush: () => Int8Array | Uint8Array;
};

type LamejsModule = {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderLike;
};

function normalizedType(type: string | null | undefined): string {
  return (type ?? "").split(";")[0].trim().toLowerCase();
}

function needsTranscode(type: string): boolean {
  // Only the iOS-incompatible containers. Unknown/empty types are left alone:
  // iOS Safari tags its recordings audio/mp4, which is already universal.
  return type.includes("webm") || type.includes("ogg");
}

function resolveAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

/** Downmix to a single mono Int16 PCM track (we record mono, but be defensive). */
function toMonoInt16(audioBuffer: AudioBuffer): Int16Array {
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const left = audioBuffer.getChannelData(0);
  const right = channelCount > 1 ? audioBuffer.getChannelData(1) : null;
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const sample = right ? (left[i] + right[i]) / 2 : left[i];
    const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

async function loadMp3Encoder(): Promise<LamejsModule["Mp3Encoder"] | null> {
  try {
    const mod = await import("@breezystack/lamejs");
    const named = (mod as Partial<LamejsModule>).Mp3Encoder;
    const fromDefault = (mod as { default?: Partial<LamejsModule> }).default?.Mp3Encoder;
    return (named ?? fromDefault ?? null) as LamejsModule["Mp3Encoder"] | null;
  } catch {
    return null;
  }
}

/**
 * Returns a universally-playable voice blob. Transcodes webm/ogg → MP3; passes
 * already-universal (mp4/aac/mp3) blobs through unchanged. Never throws.
 */
export async function transcodeVoiceForUpload(blob: Blob): Promise<Blob> {
  const type = normalizedType(blob.type);
  if (UNIVERSAL_AUDIO_TYPES.includes(type) || !needsTranscode(type)) {
    return blob;
  }

  const AudioCtor = resolveAudioContextCtor();
  if (!AudioCtor) return blob;

  let audioContext: AudioContext | null = null;
  try {
    const Mp3Encoder = await loadMp3Encoder();
    if (!Mp3Encoder) return blob;

    const arrayBuffer = await blob.arrayBuffer();
    audioContext = new AudioCtor();
    // slice(0) guards against the buffer being detached by decodeAudioData.
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const sampleRate = audioBuffer.sampleRate;
    const pcm = toMonoInt16(audioBuffer);

    const encoder = new Mp3Encoder(1, sampleRate, MP3_BITRATE_KBPS);
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < pcm.length; offset += PCM_BLOCK_SIZE) {
      const block = pcm.subarray(offset, offset + PCM_BLOCK_SIZE);
      const encoded = encoder.encodeBuffer(block);
      if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
    }
    const tail = encoder.flush();
    if (tail.length > 0) chunks.push(new Uint8Array(tail));

    const mp3Blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
    if (mp3Blob.size <= 0) return blob;
    return mp3Blob;
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "voice-transcode" } });
    return blob;
  } finally {
    if (audioContext) {
      void audioContext.close().catch(() => {});
    }
  }
}
