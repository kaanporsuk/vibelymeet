import fs from 'node:fs';
import path from 'node:path';

const mobileRoot = path.resolve(import.meta.dirname, '..');
const allowedMarker = 'guard:no-expo-crypto allow';
const excludedDirs = new Set(['.expo', '.git', 'android', 'build', 'dist', 'ios', 'node_modules']);
const excludedFiles = new Set([
  path.join('scripts', 'check-no-expo-crypto.mjs'),
]);
const directFiles = ['package.json'];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const forbiddenPatterns = [
  {
    name: "expo-crypto import",
    regex: /from\s+['"]expo-crypto['"]/,
  },
  {
    name: 'Crypto namespace import',
    regex: /import\s+\*\s+as\s+Crypto\b/,
  },
  {
    name: 'ExpoCrypto native module reference',
    regex: /ExpoCrypto/,
  },
];

function shouldScan(relativePath) {
  if (excludedFiles.has(relativePath)) return false;
  if (directFiles.includes(relativePath)) return true;
  return sourceExtensions.has(path.extname(relativePath));
}

function walk(directory, relativeDirectory = '') {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) continue;
      files.push(...walk(path.join(directory, entry.name), relativePath));
      continue;
    }

    if (shouldScan(relativePath)) {
      files.push(relativePath);
    }
  }

  return files;
}

const violations = [];
for (const relativePath of walk(mobileRoot)) {
  const absolutePath = path.join(mobileRoot, relativePath);
  const lines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line.includes(allowedMarker)) return;

    for (const pattern of forbiddenPatterns) {
      if (pattern.regex.test(line)) {
        violations.push({
          file: relativePath,
          lineNumber: index + 1,
          pattern: pattern.name,
          line,
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error('expo-crypto regression guard failed.');
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.lineNumber} [${violation.pattern}] ${violation.line}`);
  }
  process.exit(1);
}

console.log('expo-crypto regression guard passed.');
