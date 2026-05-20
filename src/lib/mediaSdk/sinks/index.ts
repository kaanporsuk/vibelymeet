import type { MediaTelemetrySink } from "@clientShared/media-sdk";
import { webMediaPostHogSink } from "./posthogSink";
import { webMediaSentrySink } from "./sentrySink";

export const webMediaTelemetrySinks: readonly MediaTelemetrySink[] = [
  webMediaPostHogSink,
  webMediaSentrySink,
];
