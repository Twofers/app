const { createRunOncePlugin, withAppBuildGradle } = require("expo/config-plugins");

const GOOGLE_SERVICES_PLUGIN_PATTERN =
  /^\s*apply\s+plugin:\s*['"]com\.google\.gms\.google-services['"]\s*$/gm;

const withAndroidDevGoogleServicesSkip = (config) =>
  withAppBuildGradle(config, (config) => {
    config.modResults.contents = config.modResults.contents.replace(GOOGLE_SERVICES_PLUGIN_PATTERN, "");
    return config;
  });

module.exports = createRunOncePlugin(
  withAndroidDevGoogleServicesSkip,
  "twofer-android-dev-google-services-skip",
  "1.0.0",
);
