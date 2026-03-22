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
  if (!plugins.some((p) => (Array.isArray(p) ? p[0] : p) === 'expo-video')) plugins.push('expo-video');
  if (!plugins.some((p) => (Array.isArray(p) ? p[0] : p) === 'expo-audio')) plugins.push('expo-audio');
  if (!plugins.some((p) => (Array.isArray(p) ? p[0] : p) === 'expo-localization')) plugins.push('expo-localization');
  if (!plugins.some((p) => (Array.isArray(p) ? p[0] : p) === '@react-native-community/datetimepicker')) {
    plugins.push('@react-native-community/datetimepicker');
  }
  if (!plugins.some((p) => (Array.isArray(p) ? p[0] : p) === 'expo-location')) {
    plugins.push([
      'expo-location',
      {
        locationWhenInUsePermission:
          'Vibely uses your location to show events and people near you.',
      },
    ]);
  }
  return {
    expo: {
      ...appJson.expo,
      plugins,
    },
  };
};
