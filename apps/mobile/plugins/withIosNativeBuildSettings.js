const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const IOS_DEPLOYMENT_TARGET = '15.1';
const ONESIGNAL_EXTENSION_TARGET = 'OneSignalNotificationServiceExtension';

/**
 * Durable managed-workflow fixes for SDK 55 / RN 0.83 native generation.
 */
module.exports = function withIosNativeBuildSettings(config) {
  config = withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const podfilePropsPath = path.join(projectRoot, 'ios', 'Podfile.properties.json');

      let current = {};
      if (fs.existsSync(podfilePropsPath)) {
        try {
          current = JSON.parse(fs.readFileSync(podfilePropsPath, 'utf8'));
        } catch {
          current = {};
        }
      }

      current['ios.buildReactNativeFromSource'] = 'true';
      current['ios.deploymentTarget'] = IOS_DEPLOYMENT_TARGET;
      fs.writeFileSync(podfilePropsPath, `${JSON.stringify(current, null, 2)}\n`);
      return modConfig;
    },
  ]);

  return withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    const [, extensionTarget] = IOSConfig.Target.findNativeTargetByName(
      project,
      ONESIGNAL_EXTENSION_TARGET
    );

    if (!extensionTarget) {
      return modConfig;
    }

    IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
      project,
      extensionTarget.buildConfigurationList
    ).forEach(([, buildConfig]) => {
      buildConfig.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = IOS_DEPLOYMENT_TARGET;
    });

    return modConfig;
  });
};
