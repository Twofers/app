import XCTest

/// App Store screenshot capture (iPhone 6.9", 1320x2868).
///
/// Launches the app with `-screenshotMode 1`, which makes the app inject a
/// synthetic authenticated session and deterministic demo data (see the RN side:
/// lib/screenshot-mode.ts). No real account, no dev-Supabase data, no PII.
///
/// Each screen is saved as an XCTAttachment named `NN_screen`. scripts/screenshots.sh
/// extracts those into fastlane/screenshots/en-US/NN_screen.png; the NN prefix
/// controls App Store ordering.
///
/// SETUP: this file must be added to a UI-testing target named `ScreenshotTests`
/// in the prebuilt Xcode project. See docs/screenshots/SETUP.md. The navigation
/// below relies on accessibility identifiers listed in that doc — add them to the
/// RN screens (e.g. `accessibilityLabel` / `testID`) so taps are locale-proof.
final class ScreenshotTests: XCTestCase {

    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-screenshotMode", "1"]
        // Deterministic language for the en-US set.
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
    }

    func testCaptureStoreScreenshots() throws {
        // The seed lands us authenticated on the consumer feed. Wait for it.
        let feed = firstMatch(ids: ["deal-feed", "deal-feed-list"], fallbackType: .collectionView)
        XCTAssertTrue(feed.waitForExistence(timeout: 30), "Deal feed did not appear — check screenshot seed / session injection.")

        // 01 — Deal feed
        capture("01_deal_feed")

        // 02 — Deal detail (open the first deal card)
        let firstDeal = firstMatch(ids: ["deal-card-0", "deal-card"], fallbackType: .button)
        if firstDeal.waitForExistence(timeout: 10) {
            firstDeal.tap()
        } else {
            app.cells.firstMatch.tap()
        }
        _ = firstMatch(ids: ["deal-detail", "deal-detail-claim"], fallbackType: .button).waitForExistence(timeout: 15)
        capture("02_deal_detail")

        // 03 — Redemption confirmation (claim / redeem the deal)
        let claim = firstMatch(ids: ["deal-detail-claim", "claim-deal-button"], fallbackType: .button)
        if claim.waitForExistence(timeout: 10) { claim.tap() }
        _ = firstMatch(ids: ["redemption-confirmation", "redemption-code"], fallbackType: .staticText).waitForExistence(timeout: 15)
        capture("03_redemption_confirmation")

        // 04 — Saved deals (Saved / Favorites tab)
        tapTab(ids: ["tab-saved", "tab-favorites"], label: "Saved")
        _ = firstMatch(ids: ["saved-deals", "favorites-list"], fallbackType: .collectionView).waitForExistence(timeout: 15)
        capture("04_saved_deals")

        // 05 — Profile
        tapTab(ids: ["tab-profile", "tab-account"], label: "Profile")
        _ = firstMatch(ids: ["profile-screen", "account-screen"], fallbackType: .scrollView).waitForExistence(timeout: 15)
        capture("05_profile")
    }

    // MARK: - Helpers

    /// Save the current screen as a keep-always attachment with a stable name.
    private func capture(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// First element matching any of the given accessibility identifiers, falling
    /// back to the first element of a type if none of the ids are present yet.
    private func firstMatch(ids: [String], fallbackType: XCUIElement.ElementType) -> XCUIElement {
        for id in ids {
            let el = app.descendants(matching: .any).matching(identifier: id).firstMatch
            if el.exists { return el }
        }
        return app.descendants(matching: fallbackType).firstMatch
    }

    /// Tap a tab bar item by accessibility id, falling back to its visible label.
    private func tapTab(ids: [String], label: String) {
        for id in ids {
            let el = app.buttons[id]
            if el.waitForExistence(timeout: 3) { el.tap(); return }
        }
        let byLabel = app.tabBars.buttons[label]
        if byLabel.waitForExistence(timeout: 5) { byLabel.tap(); return }
        app.buttons[label].firstMatch.tap()
    }
}
