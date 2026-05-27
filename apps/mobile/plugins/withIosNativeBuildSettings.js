const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const IOS_DEPLOYMENT_TARGET = '15.1';
const ONESIGNAL_EXTENSION_TARGET = 'OneSignalNotificationServiceExtension';

function unquote(value) {
  return String(value || '').replace(/^"|"$/g, '');
}

function isAppOrExtensionTarget(target) {
  const productType = unquote(target.productType);
  return (
    productType === 'com.apple.product-type.application' ||
    productType === 'com.apple.product-type.app-extension'
  );
}

function applyDeploymentTarget(project, target) {
  IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
    project,
    target.buildConfigurationList
  ).forEach(([, buildConfig]) => {
    buildConfig.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = IOS_DEPLOYMENT_TARGET;
  });
}

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
    const targetNames = new Set([
      unquote(modConfig.modRequest.projectName),
      unquote(config.name),
      ONESIGNAL_EXTENSION_TARGET,
    ].filter(Boolean));

    IOSConfig.Target.getNativeTargets(project).forEach(([, target]) => {
      const targetName = unquote(target.name);
      if (targetNames.has(targetName) || isAppOrExtensionTarget(target)) {
        applyDeploymentTarget(project, target);
      }
    });

    return modConfig;
  });
};
