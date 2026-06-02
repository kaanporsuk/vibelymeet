/**
 * Expo config. OneSignal plugin mode: "production" for EAS preview/production builds
 * (TestFlight/Store) so APNs uses production; "development" for local/dev builds.
 */
const appJson = require('./app.base.json');

const getPluginName = (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin);

const ensurePlugin = (plugins, plugin) => {
  const name = getPluginName(plugin);
  if (!plugins.some((p) => getPluginName(p) === name)) {
    plugins.push(plugin);
  }
};

module.exports = () => {
  const profile = process.env.EAS_BUILD_PROFILE;
  const oneSignalMode = profile === 'production' || profile === 'preview' ? 'production' : 'development';
  const baseOneSignalPlugin = (appJson.expo.plugins || []).find(
    (p) => Array.isArray(p) && p[0] === 'onesignal-expo-plugin'
  );
  const oneSignalOptions = Array.isArray(baseOneSignalPlugin)
    ? baseOneSignalPlugin[1] || {}
    : {};
  const plugins = [
    [
      'onesignal-expo-plugin',
      {
        ...oneSignalOptions,
        mode: oneSignalMode,
        iPhoneDeploymentTarget: '15.1',
        smallIcons: ['./assets/onesignal/ic_stat_onesignal_default.png'],
        largeIcons: ['./assets/onesignal/ic_onesignal_large_icon_default.png'],
        smallIconAccentColor: '#8B5CF6',
      },
    ],
    ...(appJson.expo.plugins || []).filter((p) => getPluginName(p) !== 'onesignal-expo-plugin'),
  ];
  ensurePlugin(plugins, 'expo-asset');
  ensurePlugin(plugins, 'expo-video');
  ensurePlugin(plugins, 'expo-audio');
  ensurePlugin(plugins, 'expo-localization');
  ensurePlugin(plugins, [
    'expo-speech-recognition',
    {
      microphonePermission: 'Vibely uses your microphone when you choose to join video dates, record Vibe Videos or chat clips, and send voice messages.',
      speechRecognitionPermission: 'Vibely uses speech recognition only when you choose optional captions for clips.',
      androidSpeechServicePackages: ['com.google.android.googlequicksearchbox', 'com.google.android.as'],
    },
  ]);
  ensurePlugin(plugins, 'expo-secure-store');
  ensurePlugin(plugins, 'expo-web-browser');
  ensurePlugin(plugins, [
    'expo-build-properties',
    {
      ios: {
        deploymentTarget: '15.1',
      },
    },
  ]);
  ensurePlugin(plugins, './plugins/withIosNativeBuildSettings');
  ensurePlugin(plugins, './plugins/withDedupedOneSignalEasExtension');
  ensurePlugin(plugins, '@react-native-community/datetimepicker');
  ensurePlugin(plugins, [
    'expo-location',
    {
      locationWhenInUsePermission:
        'Vibely uses your location while the app is open, when you choose location features, to show nearby events and people.',
    },
  ]);
  return {
    expo: {
      ...appJson.expo,
      plugins,
    },
  };
};
