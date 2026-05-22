const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Allow Metro to resolve shared code from the repo root.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

const upstreamResolveRequest = config.resolver.resolveRequest;

const sourceExts = config.resolver.sourceExts || ['ts', 'tsx', 'js', 'jsx', 'json'];

function existingFile(filePath) {
  try {
    return fs.statSync(filePath).isFile() ? filePath : null;
  } catch {
    return null;
  }
}

function existingDirectory(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function candidateFileNames(basePath, platform) {
  const platformSuffixes =
    platform === 'ios' || platform === 'android'
      ? [`.${platform}`, '.native', '']
      : platform
        ? [`.${platform}`, '']
        : [''];
  const candidates = [];

  for (const suffix of platformSuffixes) {
    for (const ext of sourceExts) {
      candidates.push(`${basePath}${suffix}.${ext}`);
    }
  }

  return candidates;
}

function resolveAliasSourceFile(basePath, platform) {
  const exactFile = existingFile(basePath);
  if (exactFile) {
    return exactFile;
  }

  if (existingDirectory(basePath)) {
    for (const candidate of candidateFileNames(path.join(basePath, 'index'), platform)) {
      const indexFile = existingFile(candidate);
      if (indexFile) {
        return indexFile;
      }
    }
  }

  for (const candidate of candidateFileNames(basePath, platform)) {
    const filePath = existingFile(candidate);
    if (filePath) {
      return filePath;
    }
  }

  return null;
}

function resolveWithDefault(context, moduleName, platform) {
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@shared/')) {
    const sub = moduleName.slice('@shared/'.length);
    const base = path.resolve(workspaceRoot, 'supabase/functions/_shared', sub);
    const filePath = resolveAliasSourceFile(base, platform);
    if (filePath) {
      return { type: 'sourceFile', filePath };
    }
  }
  if (moduleName.startsWith('@clientShared/')) {
    const sub = moduleName.slice('@clientShared/'.length);
    const base = path.resolve(workspaceRoot, 'shared', sub);
    const filePath = resolveAliasSourceFile(base, platform);
    if (filePath) {
      return { type: 'sourceFile', filePath };
    }
  }
  return resolveWithDefault(context, moduleName, platform);
};

module.exports = config;
