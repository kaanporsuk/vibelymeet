/**
 * Expo config. OneSignal plugin mode: "production" for EAS preview/production builds
 * (TestFlight/Store) so APNs uses production; "development" for local/dev builds.
 */
const appJson = require('./app.json');

module.exports = () => {
  const profile = process.env.EAS_BUILD_PROFILE;
  const oneSignalMode = profile === 'preview' || profile === 'production' ? 'production' : 'development';
  const plugins = (appJson.expo.plugins || []).map((p) => {
    if (Array.isArray(p) && p[0] === 'onesignal-expo-plugin') {
      return ['onesignal-expo-plugin', { ...(p[1] || {}), mode: oneSignalMode }];
    }
    return p;
  });
  return {
    expo: {
      ...appJson.expo,
      plugins,
    },
  };
};
