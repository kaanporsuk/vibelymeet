/**
 * Runtime-safe document picker access.
 * - Never loads `expo-document-picker` at startup.
 * - Checks native availability through Expo native module registry first.
 * - Only requires JS package inside explicit user action flow.
 */
import { NativeModulesProxy } from 'expo-modules-core';

type DocumentPickerOptions = {
  type?: string | string[];
  copyToCacheDirectory?: boolean;
  multiple?: boolean;
  base64?: boolean;
};

type DocumentPickerAsset = {
  name: string;
  size?: number;
  uri: string;
  mimeType?: string;
  lastModified: number;
};

export type SafeDocumentPickerResult =
  | { canceled: true; assets: null }
  | { canceled: false; assets: DocumentPickerAsset[] };

type ExpoDocumentPickerModule = {
  getDocumentAsync: (options?: DocumentPickerOptions) => Promise<SafeDocumentPickerResult>;
};

let cachedModule: ExpoDocumentPickerModule | null | undefined;

/** Safe startup-time check: does not import `expo-document-picker`. */
export function isDocumentPickerAvailable(): boolean {
  return !!(NativeModulesProxy as Record<string, unknown> | null | undefined)?.ExpoDocumentPicker;
}

function loadDocumentPickerModule(): ExpoDocumentPickerModule | null {
  if (cachedModule !== undefined) return cachedModule;
  if (!isDocumentPickerAvailable()) {
    cachedModule = null;
    return cachedModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('expo-document-picker') as ExpoDocumentPickerModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export async function getDocumentAsyncSafe(
  options?: DocumentPickerOptions,
): Promise<SafeDocumentPickerResult | null> {
  const mod = loadDocumentPickerModule();
  if (!mod) return null;
  return mod.getDocumentAsync(options);
}
