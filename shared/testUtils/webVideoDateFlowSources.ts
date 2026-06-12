import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * File-group source readers for web Video Date flow contract pins.
 *
 * Video Date rebuild PR 7 decomposed the two web flow giants into module
 * families. Contract tests that pinned `src/hooks/useVideoCall.ts` or
 * `src/pages/VideoDate.tsx` as single files now read the whole flow family
 * (the moved code is verbatim), so every existing regex pin keeps guarding
 * the same behavior regardless of which family file hosts it.
 *
 * Keep these lists in sync with the actual decomposition; concatenation
 * order approximates the original single-file order (module-scope helpers
 * before hook/component orchestration).
 */

export const WEB_VIDEO_CALL_FLOW_FILES = [
  "src/lib/daily/webDailyMediaHelpers.ts",
  "src/lib/daily/webDailyCallSingleton.ts",
  "src/hooks/useVideoCall.ts",
] as const;

export const WEB_VIDEO_DATE_PAGE_FLOW_FILES = [
  "src/pages/videoDate/videoDatePageShared.tsx",
  "src/pages/VideoDate.tsx",
] as const;

export const WEB_VIDEO_DATE_NAVIGATION_INTENT_FILES = [
  "shared/videoDate/navigationIntents.ts",
  "src/lib/videoDateNavigationIntents.ts",
] as const;

function concatSources(root: string, paths: readonly string[]): string {
  return paths
    .map((path) => readFileSync(join(root, path), "utf8"))
    .join("\n");
}

export function readWebVideoCallFlowSource(root: string = process.cwd()): string {
  return concatSources(root, WEB_VIDEO_CALL_FLOW_FILES);
}

export function readWebVideoDatePageFlowSource(
  root: string = process.cwd(),
): string {
  return concatSources(root, WEB_VIDEO_DATE_PAGE_FLOW_FILES);
}

/**
 * The web latch/guard owners (`src/lib/dateEntryTransitionLatch.ts`,
 * `src/lib/dateNavigationGuard.ts`) were absorbed into
 * `shared/videoDate/navigationIntents.ts` plus the web binding; pins on
 * their semantics read the combined replacement family.
 */
export function readWebVideoDateNavigationIntentsSource(
  root: string = process.cwd(),
): string {
  return concatSources(root, WEB_VIDEO_DATE_NAVIGATION_INTENT_FILES);
}
