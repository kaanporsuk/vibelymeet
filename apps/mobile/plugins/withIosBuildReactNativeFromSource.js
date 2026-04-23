const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Durable managed-workflow fix for iOS duplicate React SwiftUI class loading:
 * ensure generated Podfile.properties enables React Native source build.
 */
module.exports = function withIosBuildReactNativeFromSource(config) {
  return withDangerousMod(config, [
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
      fs.writeFileSync(podfilePropsPath, `${JSON.stringify(current, null, 2)}\n`);
      return modConfig;
    },
  ]);
};
