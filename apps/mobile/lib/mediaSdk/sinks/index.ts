import type { MediaTelemetrySink } from '@clientShared/media-sdk';
import { nativeMediaPostHogSink } from './posthogSink';
import { nativeMediaSentrySink } from './sentrySink';

export const nativeMediaTelemetrySinks: readonly MediaTelemetrySink[] = [
  nativeMediaPostHogSink,
  nativeMediaSentrySink,
];
