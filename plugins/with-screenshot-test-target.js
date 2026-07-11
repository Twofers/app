const { withXcodeProject, createRunOncePlugin } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Adds the `ScreenshotTests` XCUITest target to the generated iOS project on
 * prebuild, so the App Store screenshot pipeline works without committing ios/.
 *
 * ── SAFETY GATE ──────────────────────────────────────────────────────────────
 * This plugin is a no-op UNLESS `TWOFER_SCREENSHOT_BUILD=1` is set at prebuild
 * time. Normal and production prebuilds are therefore completely untouched — the
 * UI test target only exists in a build you explicitly made for screenshots.
 *
 *   TWOFER_SCREENSHOT_BUILD=1 npx expo prebuild -p ios
 *
 * ── BEST-EFFORT ──────────────────────────────────────────────────────────────
 * node-xcode 3.0.1 has no native UI-testing product type, so we scaffold a
 * unit-test bundle and patch it. pbxproj mutation is inherently version-fragile.
 * If prebuild fails or the target won't build, fall back to committing a
 * hand-made ios/ project (docs/screenshots/SETUP.md). This is validated on the
 * first macOS run, not on Windows.
 */

const TEST_TARGET = "ScreenshotTests";
const SCHEME_NAME = "ScreenshotTests";

const unquote = (s) => (typeof s === "string" ? s.replace(/^"|"$/g, "") : s);
const quote = (s) => `"${unquote(s)}"`;

function findAppTarget(project) {
  const first = project.getFirstTarget();
  return { uuid: first.uuid, name: unquote(first.firstTarget.name) };
}

function targetExists(project, name) {
  const targets = project.pbxNativeTargetSection();
  return Object.keys(targets).some((k) => {
    const t = targets[k];
    return t && typeof t === "object" && unquote(t.name) === name;
  });
}

function schemeXml({ appUuid, appName, testUuid, projName }) {
  const container = `container:${projName}.xcodeproj`;
  const appRef =
    `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${appUuid}" ` +
    `BuildableName="${appName}.app" BlueprintName="${appName}" ReferencedContainer="${container}"></BuildableReference>`;
  const testRef =
    `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${testUuid}" ` +
    `BuildableName="${TEST_TARGET}.xctest" BlueprintName="${TEST_TARGET}" ReferencedContainer="${container}"></BuildableReference>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1500" version="1.7">
   <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">
            ${appRef}
         </BuildActionEntry>
         <BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="NO">
            ${testRef}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration="Debug"
      selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv="YES">
      <Testables>
         <TestableReference skipped="NO">
            ${testRef}
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration="Debug"
      selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO"
      debugDocumentVersioning="YES" allowLocationSimulation="YES">
      <BuildableProductRunnable runnableDebuggingMode="0">
         ${appRef}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES">
      <BuildableProductRunnable runnableDebuggingMode="0">
         ${appRef}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration="Debug"></AnalyzeAction>
   <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"></ArchiveAction>
</Scheme>
`;
}

const withScreenshotTestTarget = (config) => {
  // Hard gate: only mutate the project for an explicit screenshot build.
  if (process.env.TWOFER_SCREENSHOT_BUILD !== "1") return config;

  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const iosRoot = cfg.modRequest.platformProjectRoot;
    const projectRoot = cfg.modRequest.projectRoot;

    if (targetExists(project, TEST_TARGET)) return cfg;

    const app = findAppTarget(project);
    const appBundleId = cfg.ios && cfg.ios.bundleIdentifier;
    if (!appBundleId) throw new Error("[screenshot-test-target] ios.bundleIdentifier is required.");
    const testBundleId = `${appBundleId}.${TEST_TARGET}`;

    // 1. Copy the Swift source into ios/ScreenshotTests/ (prebuild wipes ios/).
    const swiftSrc = path.join(projectRoot, "ios-screenshots", TEST_TARGET, `${TEST_TARGET}.swift`);
    if (!fs.existsSync(swiftSrc)) {
      throw new Error(`[screenshot-test-target] Missing source: ${swiftSrc}`);
    }
    const destDir = path.join(iosRoot, TEST_TARGET);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(swiftSrc, path.join(destDir, `${TEST_TARGET}.swift`));

    // 2. Scaffold the target (unit-test bundle) then patch to UI-testing below.
    const target = project.addTarget(TEST_TARGET, "unit_test_bundle", TEST_TARGET, testBundleId);
    const testUuid = target.uuid;

    // 3. Build phases. Sources compiles our Swift file.
    project.addBuildPhase(
      [`${TEST_TARGET}/${TEST_TARGET}.swift`],
      "PBXSourcesBuildPhase",
      "Sources",
      testUuid,
    );
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", testUuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", testUuid);

    // 3b. The source file ref isn't in a PBXGroup; anchor it to SOURCE_ROOT so
    //     Xcode resolves ScreenshotTests/ScreenshotTests.swift relative to ios/.
    const fileRefs = project.pbxFileReferenceSection();
    for (const key of Object.keys(fileRefs)) {
      const ref = fileRefs[key];
      if (ref && typeof ref === "object" && typeof ref.path === "string" && ref.path.includes(`${TEST_TARGET}.swift`)) {
        ref.sourceTree = "SOURCE_ROOT";
        ref.path = quote(`${TEST_TARGET}/${TEST_TARGET}.swift`);
      }
    }

    // 4. Fix the product type: unit-test → ui-testing.
    const nativeTargets = project.pbxNativeTargetSection();
    nativeTargets[testUuid].productType = quote("com.apple.product-type.bundle.ui-testing");

    // 5. Build settings for a UI test bundle.
    const buildConfigs = project.pbxXCBuildConfigurationSection();
    const listUuid = unquote(nativeTargets[testUuid].buildConfigurationList);
    const cfgList = project.pbxXCConfigurationList()[listUuid];
    for (const entry of cfgList.buildConfigurations) {
      const bs = buildConfigs[entry.value].buildSettings;
      delete bs.INFOPLIST_FILE; // use an auto-generated Info.plist instead
      bs.GENERATE_INFOPLIST_FILE = "YES";
      bs.PRODUCT_BUNDLE_IDENTIFIER = quote(testBundleId);
      bs.PRODUCT_NAME = quote("$(TARGET_NAME)");
      bs.TEST_TARGET_NAME = quote(app.name); // links the UI test to the app under test
      bs.TARGETED_DEVICE_FAMILY = quote("1"); // iPhone only (matches supportsTablet:false)
      bs.SWIFT_VERSION = quote("5.0");
      bs.IPHONEOS_DEPLOYMENT_TARGET = bs.IPHONEOS_DEPLOYMENT_TARGET || quote("15.1");
      bs.CODE_SIGN_STYLE = "Automatic";
      bs.CODE_SIGNING_ALLOWED = "NO"; // simulator UI tests don't need signing
      bs.MARKETING_VERSION = quote("1.0");
      bs.CURRENT_PROJECT_VERSION = quote("1");
      bs.LD_RUNPATH_SEARCH_PATHS = quote("$(inherited) @executable_path/Frameworks @loader_path/Frameworks");
      bs.ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = "NO";
    }

    // 6. Attributes so Xcode ties the UI test to the app target.
    project.addTargetAttribute("TestTargetID", app.uuid, target);
    project.addTargetAttribute("ProvisioningStyle", "Automatic", target);

    // 7. Write our own dedicated shared scheme (avoids editing Expo's app scheme).
    const projName = fs.readdirSync(iosRoot).find((f) => f.endsWith(".xcodeproj"))?.replace(/\.xcodeproj$/, "");
    if (!projName) throw new Error("[screenshot-test-target] Could not locate the .xcodeproj in ios/.");
    const schemesDir = path.join(iosRoot, `${projName}.xcodeproj`, "xcshareddata", "xcschemes");
    fs.mkdirSync(schemesDir, { recursive: true });
    fs.writeFileSync(
      path.join(schemesDir, `${SCHEME_NAME}.xcscheme`),
      schemeXml({ appUuid: app.uuid, appName: app.name, testUuid, projName }),
    );

    return cfg;
  });
};

module.exports = createRunOncePlugin(
  withScreenshotTestTarget,
  "twofer-screenshot-test-target",
  "1.0.0",
);
