import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * File-group source readers for native Video Date flow contract pins.
 *
 * Video Date rebuild PR 8 ports the native client onto the shared
 * `shared/videoDate/` layer and decomposes the two native flow giants into
 * module families. Contract tests that pinned the deleted single-file owners
 * (`apps/mobile/lib/dateEntryTransitionLatch.ts`,
 * `apps/mobile/lib/dateNavigationGuard.ts`) or the screen monoliths now read
 * the whole flow family (the moved code is verbatim), so every existing regex
 * pin keeps guarding the same behavior regardless of which family file hosts
 * it.
 *
 * Keep these lists in sync with the actual decomposition; concatenation
 * order approximates the original single-file order (module-scope helpers
 * before hook/component orchestration).
 */

/**
 * The native latch/guard owners were absorbed into
 * `shared/videoDate/navigationIntents.ts` plus the native binding; pins on
 * their semantics read the combined replacement family.
 */
export const NATIVE_VIDEO_DATE_NAVIGATION_INTENT_FILES = [
  "shared/videoDate/navigationIntents.ts",
  "apps/mobile/lib/videoDateNavigationIntents.ts",
] as const;

function concatSources(root: string, paths: readonly string[]): string {
  return paths
    .map((path) => readFileSync(join(root, path), "utf8"))
    .join("\n");
}

export function readNativeVideoDateNavigationIntentsSource(
  root: string = process.cwd(),
): string {
  return concatSources(root, NATIVE_VIDEO_DATE_NAVIGATION_INTENT_FILES);
}
