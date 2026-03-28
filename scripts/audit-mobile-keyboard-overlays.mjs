#!/usr/bin/env node
/**
 * Regression guard: raw react-native Modal + TextInput in the same screen often hides fields
 * behind the iOS keyboard when the sheet is bottom-aligned. Prefer KeyboardAwareBottomSheetModal
 * (bottom sheets) or KeyboardAwareCenteredModal (centered dialogs).
 *
 * Heuristic: file imports Modal from 'react-native', contains <Modal and <TextInput JSX,
 * and does not reference the shared keyboard-aware wrappers in source (import or JSX).
 *
 * To allow an intentional exception, add a line anywhere in the file:
 *   // keyboard-overlay-audit: allow raw Modal+TextInput — <reason>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.join(__dirname, '..', 'apps', 'mobile');

const ALLOW_PATHS = new Set([
  path.normalize(path.join(MOBILE_ROOT, 'components/keyboard/KeyboardAwareBottomSheetModal.tsx')),
  path.normalize(path.join(MOBILE_ROOT, 'components/keyboard/KeyboardAwareCenteredModal.tsx')),
]);

const EXPLICIT_ALLOW_COMMENT = /keyboard-overlay-audit:\s*allow/i;

function walkTsx(dir, acc = []) {
  if (!fs.existsSync(dir)) {
    console.error(`audit-mobile-keyboard-overlays: missing directory ${dir}`);
    process.exit(2);
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTsx(full, acc);
    else if (ent.name.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

function importsModalFromReactNative(src) {
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/gs;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (/\bModal\b/.test(m[1])) return true;
  }
  return false;
}

function usesKeyboardAwareWrappers(src) {
  return (
    /\bKeyboardAwareBottomSheetModal\b/.test(src) || /\bKeyboardAwareCenteredModal\b/.test(src)
  );
}

function main() {
  const files = walkTsx(MOBILE_ROOT);
  const violations = [];

  for (const file of files) {
    if (ALLOW_PATHS.has(path.normalize(file))) continue;

    const src = fs.readFileSync(file, 'utf8');
    if (EXPLICIT_ALLOW_COMMENT.test(src)) continue;

    if (!importsModalFromReactNative(src)) continue;
    if (!/<Modal\b/.test(src)) continue;
    if (!/<TextInput\b/.test(src)) continue;
    if (usesKeyboardAwareWrappers(src)) continue;

    violations.push(path.relative(path.join(__dirname, '..'), file));
  }

  if (violations.length) {
    console.error(
      'audit-mobile-keyboard-overlays: unsafe Modal + TextInput without keyboard-aware wrapper:\n'
    );
    for (const v of violations.sort()) console.error(`  - ${v}`);
    console.error(
      '\nUse KeyboardAwareBottomSheetModal or KeyboardAwareCenteredModal, or add:\n' +
        '  // keyboard-overlay-audit: allow — <reason>\n'
    );
    process.exit(1);
  }

  console.log('audit-mobile-keyboard-overlays: OK (no violations).');
}

main();
