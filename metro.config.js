// Enables web builds to bundle even when native-only modules exist.
// In particular, some native-focused modules crash Metro on web/SSR.
// We resolve them to lightweight stubs for the web platform.

const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "react-native-maps") {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, "lib/stubs/react-native-maps.web.tsx"),
    };
  }
  if (platform === "web" && moduleName === "expo-notifications") {
    return {
      type: "sourceFile",
      filePath: path.resolve(__dirname, "lib/stubs/expo-notifications.web.ts"),
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

