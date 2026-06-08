const { AndroidConfig, createRunOncePlugin, withAndroidManifest } = require("expo/config-plugins");

const AUDIO_BACKGROUND_SERVICES = [
  "expo.modules.audio.service.AudioControlsService",
  "expo.modules.audio.service.AudioRecordingService",
];

function removeExistingServiceEntries(application, serviceName) {
  const shortName = serviceName.replace("expo.modules.audio", "");
  application.service = (application.service || []).filter((service) => {
    const name = service?.$?.["android:name"];
    return name !== serviceName && name !== shortName;
  });
}

function addServiceRemoval(application, serviceName) {
  removeExistingServiceEntries(application, serviceName);
  application.service.push({
    $: {
      "android:name": serviceName,
      "tools:node": "remove",
    },
  });
}

const withAndroidAudioServiceCleanup = (config) =>
  withAndroidManifest(config, (config) => {
    config.modResults = AndroidConfig.Manifest.ensureToolsAvailable(config.modResults);
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);

    for (const serviceName of AUDIO_BACKGROUND_SERVICES) {
      addServiceRemoval(application, serviceName);
    }

    return config;
  });

module.exports = createRunOncePlugin(
  withAndroidAudioServiceCleanup,
  "twofer-android-audio-service-cleanup",
  "1.0.0",
);
