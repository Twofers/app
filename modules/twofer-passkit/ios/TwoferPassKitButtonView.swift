import ExpoModulesCore
import PassKit
import UIKit

final class TwoferPassKitButtonView: ExpoView {
  let onPress = EventDispatcher()

  private let passButton = PKAddPassButton(addPassButtonStyle: .black)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    passButton.translatesAutoresizingMaskIntoConstraints = false
    passButton.addTarget(self, action: #selector(handlePress), for: .touchUpInside)
    addSubview(passButton)

    NSLayoutConstraint.activate([
      passButton.leadingAnchor.constraint(equalTo: leadingAnchor),
      passButton.trailingAnchor.constraint(equalTo: trailingAnchor),
      passButton.topAnchor.constraint(equalTo: topAnchor),
      passButton.bottomAnchor.constraint(equalTo: bottomAnchor)
    ])
  }

  func setDisabled(_ disabled: Bool) {
    passButton.isEnabled = !disabled
  }

  @objc private func handlePress() {
    onPress([:])
  }
}
