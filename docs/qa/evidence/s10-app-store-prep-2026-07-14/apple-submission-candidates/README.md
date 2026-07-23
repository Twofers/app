# Apple Screenshot Candidate Derivatives

Generated on July 14, 2026 from the Samsung S10 QA screenshots in the parent folder.

These files are exact-size PNG derivatives for App Store Connect upload testing and visual review. They are not a substitute for final iPhone screenshots from the release-candidate/TestFlight build because the source captures came from Android hardware.

## Output Sets

- `iphone-6-9-1290x2796/` - 7 PNGs at 1290 x 2796, accepted for Apple's 6.9-inch iPhone portrait screenshot slot.
- `iphone-6-5-1242x2688/` - 7 PNGs at 1242 x 2688, backup 6.5-inch portrait size.
- `iphone-6-9-1290x2796_contact_sheet.png` - visual contact sheet for the 6.9-inch set.
- `iphone-6-5-1242x2688_contact_sheet.png` - visual contact sheet for the 6.5-inch set.

## Included Screens

- Customer Home with live deal
- Customer Deal detail
- Customer Map
- Customer Settings
- Business Create hub
- Business Redeem ticket-code tab
- Business Offers dashboard

## Excluded Screens

- Account screen: showed a real test-account email.
- Login debug screen: keyboard/input troubleshooting evidence only.
- Wallet active-ticket screen: contains a live claim code and must remain QA-only.

## Processing

- Removed the phone status bar and Android system navigation area.
- Preserved full app width to avoid clipping titles and controls.
- Padded vertically on a white canvas to reach exact Apple-accepted dimensions.
- Re-encoded as 24-bit PNGs.
