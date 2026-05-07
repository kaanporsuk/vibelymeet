const ONESIGNAL_EXTENSION_TARGET = 'OneSignalNotificationServiceExtension';

const withDedupedOneSignalEasExtension = (config) => {
  const appExtensions = config.extra?.eas?.build?.experimental?.ios?.appExtensions;
  if (!Array.isArray(appExtensions)) {
    return config;
  }

  const seenOneSignalBundles = new Set();
  const dedupedAppExtensions = appExtensions.filter((extension) => {
    if (extension?.targetName !== ONESIGNAL_EXTENSION_TARGET) {
      return true;
    }

    const key = extension.bundleIdentifier || ONESIGNAL_EXTENSION_TARGET;
    if (seenOneSignalBundles.has(key)) {
      return false;
    }

    seenOneSignalBundles.add(key);
    return true;
  });

  return {
    ...config,
    extra: {
      ...config.extra,
      eas: {
        ...config.extra?.eas,
        build: {
          ...config.extra?.eas?.build,
          experimental: {
            ...config.extra?.eas?.build?.experimental,
            ios: {
              ...config.extra?.eas?.build?.experimental?.ios,
              appExtensions: dedupedAppExtensions,
            },
          },
        },
      },
    },
  };
};

module.exports = withDedupedOneSignalEasExtension;
