import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(__dirname, '..');
const repoRoot = resolve(mobileRoot, '../..');
const metroConfig = require(join(mobileRoot, 'metro.config.js'));
const sourceRoots = [
  mobileRoot,
  join(repoRoot, 'shared'),
  join(repoRoot, 'supabase/functions/_shared'),
];

const platforms = ['ios', 'android'];
const moduleSpecifiers = new Set([
  '@clientShared/media-sdk',
  '@clientShared/matching/videoDateSnapshot',
  '@shared/profileContracts',
]);
const importSpecifierPattern = /(?:from\s+|import\s+|import\(\s*|require\(\s*)['"]([^'"]+)['"]/g;
const sourceFilePattern = /\.(cjs|js|jsx|mjs|ts|tsx)$/;
const ignoredDirectories = new Set(['.expo', 'node_modules']);

function collectAliasSpecifiers(dirPath) {
  for (const entry of readdirSync(dirPath)) {
    if (ignoredDirectories.has(entry)) {
      continue;
    }

    const entryPath = join(dirPath, entry);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      collectAliasSpecifiers(entryPath);
      continue;
    }

    if (!sourceFilePattern.test(entry)) {
      continue;
    }

    const source = readFileSync(entryPath, 'utf8');
    for (const match of source.matchAll(importSpecifierPattern)) {
      const moduleName = match[1];
      if (moduleName.startsWith('@clientShared/') || moduleName.startsWith('@shared/')) {
        moduleSpecifiers.add(moduleName);
      }
    }
  }
}

function assertResolvedSourceFile(moduleName, platform) {
  const context = {
    resolveRequest() {
      throw new Error(`Metro alias ${moduleName} fell through to the default resolver`);
    },
  };
  const result = metroConfig.resolver.resolveRequest(context, moduleName, platform);

  if (!result || result.type !== 'sourceFile' || typeof result.filePath !== 'string') {
    throw new Error(`${platform}:${moduleName} resolved to an invalid Metro result: ${JSON.stringify(result)}`);
  }

  const stat = statSync(result.filePath);
  if (!stat.isFile()) {
    throw new Error(`${platform}:${moduleName} resolved to a non-file path: ${result.filePath}`);
  }

  return relative(repoRoot, result.filePath);
}

for (const sourceRoot of sourceRoots) {
  collectAliasSpecifiers(sourceRoot);
}

const failures = [];
const highlights = {};

for (const platform of platforms) {
  for (const moduleName of moduleSpecifiers) {
    try {
      const resolvedPath = assertResolvedSourceFile(moduleName, platform);
      if (moduleName === '@clientShared/media-sdk') {
        highlights[platform] = resolvedPath;
      }
    } catch (error) {
      failures.push(`${platform}:${moduleName}: ${error.message}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Metro alias guard failed for ${failures.length} resolution(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Metro alias guard passed for ${moduleSpecifiers.size} imports on ${platforms.join('/')} ` +
    `(media-sdk: ${highlights.ios || highlights.android}).`,
);
