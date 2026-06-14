// Enables web builds to bundle even when native-only modules exist.
// In particular, some native-focused modules crash Metro on web/SSR.
// We resolve them to lightweight stubs for the web platform.

const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const escapeForRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const localPathPattern = (relativePath) => {
  const escapedPath = path
    .resolve(__dirname, relativePath)
    .split(/[\\/]+/)
    .map(escapeForRegex)
    .join("[/\\\\]");
  return new RegExp(`${escapedPath}(?:[/\\\\].*)?$`);
};

const existingBlockList = config.resolver.blockList
  ? Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList]
  : [];

config.resolver.blockList = [
  ...existingBlockList,
  // Local Codex/Claude artifacts can contain nested worktrees and Android build
  // paths that exceed Windows watcher limits. They are not app source.
  localPathPattern(".claude"),
  localPathPattern(".codex"),
  localPathPattern(".cursor"),
  localPathPattern("claude-history-export"),
  localPathPattern("project-knowledge"),
  localPathPattern("cursor_globalStorage_backup"),
  localPathPattern("cursor_workspaceStorage_backup"),
  localPathPattern("twoforone_full_backup"),
  localPathPattern("meeting minutes"),
  localPathPattern("share_deal_smoke_20260606"),
  localPathPattern("artifacts"),
  localPathPattern("outdated"),
  localPathPattern("dist"),
  /[/\\]application-[^/\\]+\.apk$/,
  /[/\\]claude-history-secret-scan\.txt$/,
];

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

